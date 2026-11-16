/**
 * Milestone 8 — dress rehearsal against the deployed site: N simulated
 * students (30 by default) enter the session code, then type the Workshop 1
 * circuits for M minutes (10 by default). Each typing pause sends the code to
 * /api/run, exactly like the browser does (partial code included, so many
 * runs are syntax errors, as in class).
 *
 *   HQ_SESSION_CODE=<code> pnpm rehearsal                       # 30 students, 10 min, production
 *   HQ_SESSION_CODE=<code> pnpm rehearsal --students 1 --minutes 1   # production latency only
 *   pnpm rehearsal --url http://localhost:3000 --code quantum --students 3 --minutes 1
 *
 * Prints a report every 30 s and a verdict at the end; raw results go to
 * .sandbox/rehearsal-<timestamp>.json. All students share this machine's IP,
 * like a class behind a school network.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "https://quantum-viz-six.vercel.app" },
    code: { type: "string" },
    students: { type: "string", default: "30" },
    minutes: { type: "string", default: "10" },
    /** students arrive over this many seconds, like a class opening the page */
    rampup: { type: "string", default: "60" },
  },
});

const BASE = args.url!.replace(/\/$/, "");
const CODE = args.code ?? process.env.HQ_SESSION_CODE;
const STUDENTS = Number(args.students);
const DURATION_MS = Number(args.minutes) * 60_000;
const RAMPUP_MS = Number(args.rampup) * 1000;
const CLIENT_TIMEOUT_MS = 45_000; // same as components/useRun.ts
/** CLAUDE.md, milestone 1: circuit on screen less than 1.5 s after the typing pause. */
const TARGET_MS = 1_500;
/** the browser waits this long after the last keystroke (components/useRun.ts) */
const DEBOUNCE_MS = 450;

if (!CODE) {
  console.error("Session code missing: HQ_SESSION_CODE=<code> pnpm rehearsal, or --code <code>");
  process.exit(2);
}

// --- what students type -----------------------------------------------------

const CIRCUITS_DIR = "runner/tests/circuits";
const circuits = readdirSync(CIRCUITS_DIR)
  .filter((f) => f.endsWith(".py"))
  .sort()
  .map((f) => ({ name: f.replace(/\.py$/, ""), code: readFileSync(join(CIRCUITS_DIR, f), "utf8") }));

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/**
 * The code at each typing pause while a student writes `code`: growing
 * prefixes (cut at random points, often mid-line), then the full code, then a
 * few small edits of the full code (an angle changed, a typo and its fix).
 */
function typingSession(code: string): { code: string; complete: boolean }[] {
  const steps: { code: string; complete: boolean }[] = [];
  const pauses = Math.floor(rand(3, 8));
  for (let i = 1; i <= pauses; i++) {
    const cut = Math.floor((code.length * i) / (pauses + 1) + rand(-20, 20));
    steps.push({ code: code.slice(0, Math.max(1, Math.min(code.length - 1, cut))), complete: false });
  }
  steps.push({ code, complete: true });
  const edits = Math.floor(rand(1, 5));
  for (let i = 0; i < edits; i++) {
    if (Math.random() < 0.3) {
      steps.push({ code: code.replace("wires=", "wire="), complete: false }); // typo…
      steps.push({ code, complete: true }); // …fixed
    } else {
      steps.push({ code: `${code}\n# essai ${i} ${Math.random().toFixed(4)}\n`, complete: true }); // a cosmetic change: new run, same circuit
    }
  }
  return steps;
}

// --- measurements -------------------------------------------------------------

type Sample = {
  t: number; // ms since start
  student: number;
  ms: number;
  status: number; // 0: network error / timeout
  outcome: string; // "ok", "syntax", "runtime", …, "infra", "http-429", "network"
  complete: boolean; // full acceptance circuit: must be ok
  first: boolean; // first run of this student (pool may be cold)
};

const samples: Sample[] = [];
const logins: { student: number; ms: number; tries: number; ok: boolean }[] = [];
const wrongAnswers: string[] = [];
const t0 = performance.now();
const now = () => performance.now() - t0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function login(student: number): Promise<string | null> {
  const start = performance.now();
  for (let tries = 1; tries <= 10; tries++) {
    try {
      const res = await fetch(`${BASE}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: CODE }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 200) {
        const cookie = res.headers.getSetCookie().find((c) => c.startsWith("hq_session="));
        logins.push({ student, ms: performance.now() - start, tries, ok: !!cookie });
        return cookie ? cookie.split(";")[0] : null;
      }
      if (res.status === 401) {
        console.error(`student ${student}: wrong session code`);
        logins.push({ student, ms: performance.now() - start, tries, ok: false });
        return null;
      }
      await sleep(1000 * Number(res.headers.get("retry-after") ?? 2));
    } catch {
      await sleep(2000);
    }
  }
  logins.push({ student, ms: performance.now() - start, tries: 10, ok: false });
  return null;
}

async function run(student: number, cookie: string, code: string, complete: boolean, first: boolean, circuit: string) {
  const start = performance.now();
  let status = 0;
  let outcome = "network";
  try {
    const res = await fetch(`${BASE}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
    });
    status = res.status;
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: { kind: string; message: string } } | null;
    if (!body || typeof body.ok !== "boolean") outcome = `http-${status}`;
    else if (body.ok) outcome = "ok";
    else outcome = status === 200 ? body.error!.kind : status === 503 ? "infra" : `http-${status}`;
    if (complete && body && !body.ok && status === 200) wrongAnswers.push(`${circuit}: ${body.error?.kind} — ${body.error?.message}`);
  } catch {
    // timeout or connection failure
  }
  samples.push({ t: now(), student, ms: performance.now() - start, status, outcome, complete, first });
  return { status, outcome };
}

async function student(i: number, end: number) {
  await sleep((RAMPUP_MS * i) / Math.max(1, STUDENTS));
  const cookie = await login(i);
  if (!cookie) return;
  let first = true;
  while (now() < end) {
    const c = pick(circuits);
    for (const step of typingSession(c.code)) {
      if (now() >= end) return;
      await sleep(DEBOUNCE_MS + rand(1500, 9000)); // typing, then the pause
      const r = await run(i, cookie, step.code, step.complete, first, c.name);
      first = false;
      if (r.outcome === "http-429") await sleep(2000);
      if (r.outcome === "infra" || r.outcome === "network") await sleep(2000); // the browser retries after 2–3 s
    }
    await sleep(rand(5_000, 20_000)); // reading the circuit, listening to Tao
  }
}

// --- report ---------------------------------------------------------------------

function quantile(xs: number[], q: number) {
  if (!xs.length) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const fmt = (ms: number) => (Number.isNaN(ms) ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

function summarize(xs: Sample[]) {
  const answered = xs.filter((s) => s.status === 200);
  const ms = answered.map((s) => s.ms);
  const counts: Record<string, number> = {};
  for (const s of xs) counts[s.outcome] = (counts[s.outcome] ?? 0) + 1;
  return {
    runs: xs.length,
    answered: answered.length,
    p50: quantile(ms, 0.5),
    p95: quantile(ms, 0.95),
    max: ms.length ? Math.max(...ms) : Number.NaN,
    overTarget: ms.filter((m) => m > TARGET_MS).length,
    failures: xs.filter((s) => s.status !== 200).length,
    counts,
  };
}

function line(label: string, xs: Sample[]) {
  const s = summarize(xs);
  const kinds = Object.entries(s.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  return `${label.padEnd(18)} ${String(s.runs).padStart(5)} runs  p50 ${fmt(s.p50).padStart(7)}  p95 ${fmt(s.p95).padStart(7)}  max ${fmt(s.max).padStart(7)}  > 1,5 s: ${s.overTarget}  échecs: ${s.failures}  [${kinds}]`;
}

// --- main -------------------------------------------------------------------------

console.log(`Répétition : ${STUDENTS} étudiant(s), ${args.minutes} min, ${BASE}`);
console.log(`Circuits : ${circuits.map((c) => c.name).join(", ")}\n`);

const end = RAMPUP_MS + DURATION_MS;
let lastReport = 0;
const ticker = setInterval(() => {
  const t = now();
  const window = samples.filter((s) => s.t > lastReport);
  const active = new Set(window.map((s) => s.student)).size;
  console.log(`${line(`${Math.round(t / 1000)} s (${active} actifs)`, window)}`);
  lastReport = t;
}, 30_000);

await Promise.all(Array.from({ length: STUDENTS }, (_, i) => student(i, end)));
clearInterval(ticker);

const warm = samples.filter((s) => !s.first);
const firsts = samples.filter((s) => s.first);
const all = summarize(warm);
const loginMs = logins.filter((l) => l.ok).map((l) => l.ms);

console.log("\n=== Bilan ===");
console.log(`Connexions : ${logins.filter((l) => l.ok).length}/${STUDENTS} réussies, p50 ${fmt(quantile(loginMs, 0.5))}, max ${fmt(Math.max(...loginMs, 0))}`);
console.log(line("premier circuit", firsts));
console.log(line("ensuite", warm));
console.log(`Débit moyen : ${(samples.length / (now() / 1000)).toFixed(1)} exécutions/s`);
if (wrongAnswers.length) {
  console.log(`\nCircuits de recette complets qui n'ont PAS répondu ok (${wrongAnswers.length}) :`);
  for (const w of [...new Set(wrongAnswers)].slice(0, 10)) console.log(`  ${w}`);
}

const checks = [
  { label: "tous les étudiants sont entrés", ok: logins.filter((l) => l.ok).length === STUDENTS },
  { label: `95 % des circuits en moins de ${TARGET_MS / 1000} s (hors premier)`, ok: all.p95 <= TARGET_MS },
  { label: "aucune requête perdue (réseau, 5xx, 429)", ok: all.failures === 0 },
  { label: "chaque circuit de recette complet répond ok", ok: wrongAnswers.length === 0 },
];
console.log("");
for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.label}`);

mkdirSync(".sandbox", { recursive: true });
const file = `.sandbox/rehearsal-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ base: BASE, students: STUDENTS, minutes: Number(args.minutes), logins, samples, wrongAnswers }, null, 1));
console.log(`\nDétail : ${file}`);
process.exit(checks.every((c) => c.ok) ? 0 : 1);

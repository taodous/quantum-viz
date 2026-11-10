/**
 * Milestone 1 — measure end-to-end latency of running a Bell circuit in
 * Vercel Sandbox, comparing a fresh Python process per run ("cold") with a
 * pre-warmed fork server ("warm").
 *
 *   pnpm sandbox:snapshot   # once
 *   pnpm sandbox:latency
 *
 * Results are printed and saved to .sandbox/latency-<timestamp>.json.
 */
import { Sandbox } from "@vercel/sandbox";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const snap = JSON.parse(readFileSync(".sandbox/snapshot.json", "utf8")) as { snapshotId: string; region: string; venv: string };
const PY = `${snap.venv}/bin/python`;
const DIR = "/vercel/sandbox/runner";
const PORT = 7000;
const REPEAT = 8;
const EXTRA_SANDBOXES = 2; // only measure create + warm-up time on these

const bell = readFileSync("runner/latency/bell.py");
const files = ["probe.py", "warm_server.py", "bell.py", "client.py"].map((f) => ({ path: `${DIR}/${f}`, content: readFileSync(`runner/latency/${f}`) }));

/** A slightly different circuit every time, like a student typing. */
const variant = (i: number) => bell.toString().replace("qml.CNOT(wires=[0, 1])", `qml.RY(${(0.1 * (i + 1)).toFixed(2)}, wires=1)\n    qml.CNOT(wires=[0, 1])`);

type Stats = { n: number; min: number; p50: number; p90: number; max: number };
const results: Record<string, Stats | number | string> = {};

function stats(xs: number[]): Stats {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: Math.round(s[0]), p50: Math.round(q(0.5)), p90: Math.round(q(0.9)), max: Math.round(s[s.length - 1]) };
}

async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const t = performance.now();
  const v = await fn();
  return [performance.now() - t, v];
}

async function series(label: string, n: number, fn: (i: number) => Promise<unknown>) {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push((await timed(() => fn(i)))[0]);
  results[label] = stats(xs);
  console.log(label.padEnd(44), JSON.stringify(results[label]));
  return xs;
}

function createFromSnapshot() {
  return Sandbox.create({
    source: { type: "snapshot", snapshotId: snap.snapshotId },
    region: snap.region,
    resources: { vcpus: 1 },
    networkPolicy: "deny-all",
    persistent: false,
    ports: [PORT],
    timeout: 10 * 60_000,
  });
}

async function startWarmServer(sb: Sandbox) {
  await sb.runCommand({ cmd: PY, args: ["warm_server.py"], cwd: DIR, detached: true });
  for (let i = 0; i < 200; i++) {
    const r = await sb.runCommand({ cmd: "python3", args: ["-S", "-I", "client.py", `http://127.0.0.1:${PORT}/`], cwd: DIR });
    if (r.exitCode === 0) return JSON.parse(await r.stdout()) as { importMs: number; warmupMs: number };
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("warm server never became ready");
}

function expectOk(raw: string, label: string) {
  const out = JSON.parse(raw);
  if (!out.ok || out.circuits?.length !== 1) throw new Error(`${label}: unexpected output ${raw.slice(0, 300)}`);
  return out as { execMs: number; serverMs?: number };
}

const sandboxes: Sandbox[] = [];
try {
  // --- Sandbox creation from snapshot ------------------------------------
  const createMs: number[] = [];
  const [tCreate, sb] = await timed(createFromSnapshot);
  sandboxes.push(sb);
  createMs.push(tCreate);
  await sb.writeFiles(files);

  // --- Bare API round trip -------------------------------------------------
  await series("api round trip (runCommand true)", REPEAT, () => sb.runCommand("true"));

  // --- Cold: new Python process per run ------------------------------------
  await series("cold: python -c 'import pennylane'", 4, () => sb.runCommand(PY, ["-c", "import pennylane"]));
  const coldExec: number[] = [];
  await series("cold: bell, new process (end to end)", REPEAT, async () => {
    const r = await sb.runCommand({ cmd: PY, args: ["probe.py", "bell.py"], cwd: DIR });
    coldExec.push(expectOk(await r.stdout(), "cold").execMs);
  });
  results["cold: exec only (inside python)"] = stats(coldExec);

  // --- Warm fork server -----------------------------------------------------
  const [tReady, ready] = await timed(() => startWarmServer(sb));
  results["warm server: start → ready (ms)"] = Math.round(tReady);
  results["warm server: import pennylane (ms)"] = ready.importMs;
  results["warm server: warm-up circuit (ms)"] = ready.warmupMs;
  console.log("warm server ready", Math.round(tReady), "ms", ready);

  const serverMs: number[] = [];
  await series("warm: via runCommand client (end to end)", REPEAT, async (i) => {
    const r = await sb.runCommand({ cmd: "python3", args: ["-S", "-I", "client.py", `http://127.0.0.1:${PORT}/`, variant(i)], cwd: DIR });
    serverMs.push(expectOk(await r.stdout(), "warm client").serverMs!);
  });
  results["warm: fork + exec inside server"] = stats(serverMs);

  const url = sb.domain(PORT);
  let portReachable = true;
  try {
    await series("warm: via exposed port (end to end)", REPEAT, async (i) => {
      const res = await fetch(url, { method: "POST", body: variant(i + 100), signal: AbortSignal.timeout(15_000) });
      expectOk(await res.text(), "warm port");
    });
    const burst = await Promise.all(
      Array.from({ length: 10 }, async (_, i) => (await timed(async () => expectOk(await (await fetch(url, { method: "POST", body: variant(i + 200) })).text(), "burst")))[0]),
    );
    results["warm: burst of 10 concurrent, 1 vCPU"] = stats(burst);
    console.log("warm: burst of 10 concurrent, 1 vCPU".padEnd(44), JSON.stringify(results["warm: burst of 10 concurrent, 1 vCPU"]));
  } catch (err) {
    portReachable = false;
    results["warm: via exposed port"] = `unreachable: ${(err as Error).message}`;
    console.log("exposed port unreachable:", (err as Error).message);
  }
  results["exposed port reachable with deny-all"] = String(portReachable);

  // --- Pool refill cost: new sandbox until warm server ready -----------------
  const refill: number[] = [];
  for (let i = 0; i < EXTRA_SANDBOXES; i++) {
    const [t, extra] = await timed(createFromSnapshot);
    sandboxes.push(extra);
    createMs.push(t);
    await extra.writeFiles(files);
    const [tWarm] = await timed(() => startWarmServer(extra));
    refill.push(t + tWarm);
  }
  results["create sandbox from snapshot"] = stats(createMs);
  results["pool refill: create → warm ready"] = stats(refill);
  console.log("create sandbox from snapshot".padEnd(44), JSON.stringify(results["create sandbox from snapshot"]));
  console.log("pool refill: create → warm ready".padEnd(44), JSON.stringify(results["pool refill: create → warm ready"]));
} finally {
  await Promise.allSettled(sandboxes.map((s) => s.stop()));
}

mkdirSync(".sandbox", { recursive: true });
const out = `.sandbox/latency-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), region: snap.region, results }, null, 2));
console.log(`\nsaved ${out}`);

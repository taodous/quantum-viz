/**
 * Milestone 4 — check the real sandbox pool end to end, against Vercel Sandbox:
 * creation race between two "function instances", latency through the pool,
 * token check on the exposed port, student code confined to `nobody`.
 *
 *   pnpm sandbox:pool-check
 *
 * Uses its own sandbox names (stopped at the end), not the dev server's pool.
 */
import { Sandbox } from "@vercel/sandbox";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { serverConfig } from "../../lib/server/config";
import { Pool } from "../../lib/server/pool";
import { runOnPool } from "../../lib/server/run";
import { runnerBundle } from "../../lib/server/runnerFiles";
import { vercelBackend } from "../../lib/server/sandboxBackend";

process.loadEnvFile(".env.local");

const cfg = serverConfig();
const bundle = runnerBundle(cfg.snapshotId);
const prefix = `qvc-${randomBytes(3).toString("hex")}`;
const makePool = () => new Pool({ backend: vercelBackend(cfg, bundle.files), secret: cfg.sessionSecret, prefix, size: 1, sandboxTimeoutMs: 15 * 60_000, log: (m) => console.log(`  [pool] ${m}`) });

const bell = readFileSync("runner/tests/circuits/07_bell.py", "utf8");
const ms = (t: number) => `${Math.round(performance.now() - t)} ms`;
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

try {
  // Two function instances, cold, at the same time: one sandbox only.
  const a = makePool();
  const b = makePool();
  let t = performance.now();
  const [ta, tb] = await Promise.all([a.acquire({ waitMs: 60_000 }), b.acquire({ waitMs: 60_000 })]);
  console.log(`cold acquire (create + server ready): ${ms(t)}`);
  check("two instances race to create: same sandbox", ta.name === tb.name && ta.url === tb.url, ta.name);
  const listed = await (await Sandbox.list({ namePrefix: prefix, sortBy: "name" })).toArray();
  check("exactly one sandbox exists", listed.length === 1, listed.map((s) => `${s.name}:${s.status}`).join(", "));

  // Latency through the pool (the function → sandbox leg, from this PC).
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    t = performance.now();
    const r = await runOnPool(a, bell.replace("wires=[0, 1])", `wires=[0, 1])  # ${i}`));
    times.push(performance.now() - t);
    if (i === 0) check("Bell runs", r.status === 200 && r.body.ok && r.body.circuits.length === 2);
  }
  times.sort((x, y) => x - y);
  console.log(`warm run via pool: p50 ${Math.round(times[5])} ms, max ${Math.round(times[9])} ms`);

  // Student mistakes are normal answers.
  const syntax = await runOnPool(a, "x = (\n");
  check("syntax error → 200, kind syntax", syntax.status === 200 && !syntax.body.ok && syntax.body.error.kind === "syntax");
  t = performance.now();
  const loop = await runOnPool(a, "while True:\n    pass\n");
  check("infinite loop → timeout", loop.status === 200 && !loop.body.ok && loop.body.error.kind === "timeout", ms(t));

  // The exposed port is public: no token, no run.
  const noToken = await fetch(ta.url, { method: "POST", body: bell });
  check("POST without token → 401", noToken.status === 401);
  const badToken = await fetch(ta.url, { method: "POST", body: bell, headers: { authorization: "Bearer nope" } });
  check("POST with a wrong token → 401", badToken.status === 401);

  // Student code runs as nobody, away from the server.
  const probe = await runOnPool(
    a,
    [
      "import os",
      "print('uid', os.getuid())",
      "for path in ['/proc/%d/environ' % os.getppid(), '/proc/1/environ', '/root/x']:",
      "    try:",
      "        open(path).read(1); print('READ', path)",
      "    except OSError as e:",
      "        print('denied', path, type(e).__name__)",
      "try:",
      "    os.kill(os.getppid(), 9); print('KILLED parent')",
      "except PermissionError:",
      "    print('cannot signal parent')",
      "import socket",
      "try:",
      "    socket.create_connection(('1.1.1.1', 80), timeout=2); print('NETWORK open')",
      "except OSError as e:",
      "    print('no network', type(e).__name__)",
    ].join("\n"),
  );
  const out = probe.body.ok ? probe.body.stdout : JSON.stringify(probe.body);
  console.log(out.replace(/^/gm, "    "));
  check("student code is not root", probe.body.ok && /uid (\d+)/.exec(out)?.[1] !== "0");
  check("cannot read the server's environment or root files", !out.includes("READ"));
  check("cannot kill the server", out.includes("cannot signal parent"));
  check("no outbound network", out.includes("no network"));
  const after = await runOnPool(a, bell);
  check("server still serving afterwards", after.status === 200 && after.body.ok);
} finally {
  const all = await (await Sandbox.list({ namePrefix: prefix, sortBy: "name" })).toArray();
  await Promise.allSettled(
    all.map(async (s) => {
      const sb = await Sandbox.get({ name: s.name });
      await sb.stop().catch(() => {});
      await sb.delete();
    }),
  );
  console.log(`stopped ${all.length} sandbox(es)`);
}
process.exitCode = failures ? 1 : 0;

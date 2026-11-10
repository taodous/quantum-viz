/**
 * Milestone 1 — build a Sandbox snapshot with Python + PennyLane preinstalled.
 *
 *   pnpm sandbox:snapshot
 *
 * Writes the snapshot id to .sandbox/snapshot.json (git-ignored).
 */
import { Sandbox } from "@vercel/sandbox";
import { mkdirSync, writeFileSync } from "node:fs";

process.loadEnvFile(".env.local");

export const REGION = "cdg1"; // Paris: closest to the students
export const PENNYLANE_VERSION = "0.45.1";
export const VENV = "/vercel/sandbox/venv";

const t0 = performance.now();
const sandbox = await Sandbox.create({
  image: "vercel/sandbox/python:3.14",
  region: REGION,
  resources: { vcpus: 2 },
  timeout: 15 * 60_000,
  persistent: false,
});
console.log(`sandbox ${sandbox.name} up in ${Math.round(performance.now() - t0)} ms`);

async function sh(script: string) {
  const r = await sandbox.runCommand({ cmd: "bash", args: ["-lc", script], stdout: process.stdout, stderr: process.stderr });
  if (r.exitCode !== 0) throw new Error(`failed (${r.exitCode}): ${script}`);
}

try {
  await sh(`python3 --version && uv --version`);
  const tInstall = performance.now();
  await sh(`uv venv ${VENV} && uv pip install --python ${VENV}/bin/python pennylane==${PENNYLANE_VERSION}`);
  console.log(`install: ${Math.round(performance.now() - tInstall)} ms`);
  // Byte-compile everything now so no run pays for it later.
  await sh(`${VENV}/bin/python -m compileall -q ${VENV}/lib > /dev/null; ${VENV}/bin/python -c "import pennylane as qml, sys; print('pennylane', qml.__version__, 'python', sys.version.split()[0])"`);

  const snap = await sandbox.snapshot({ expiration: 0 });
  mkdirSync(".sandbox", { recursive: true });
  writeFileSync(
    ".sandbox/snapshot.json",
    JSON.stringify({ snapshotId: snap.snapshotId, region: REGION, pennylane: PENNYLANE_VERSION, venv: VENV, createdAt: new Date().toISOString() }, null, 2),
  );
  console.log(`snapshot ${snap.snapshotId} saved to .sandbox/snapshot.json`);
} catch (err) {
  await sandbox.stop();
  throw err;
}

/**
 * Run the runner's pytest suite inside a Sandbox built from the production
 * snapshot (Linux + the exact Python/PennyLane), including the fork-server
 * tests that cannot run on Windows.
 *
 *   pnpm sandbox:test-runner
 *
 * The sandbox gets network access only to install pytest: it runs our own
 * tests, never student code.
 */
import { Sandbox } from "@vercel/sandbox";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

process.loadEnvFile(".env.local");

const snap = JSON.parse(readFileSync(".sandbox/snapshot.json", "utf8")) as { snapshotId: string; region: string; venv: string };
const DIR = "/vercel/sandbox/runner";

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "__pycache__" || name === ".venv" || name === ".pytest_cache") return [];
    return statSync(p).isDirectory() ? collect(p) : [p];
  });
}

const files = ["runner/pyproject.toml", ...collect("runner/qrunner"), ...collect("runner/tests")].map((p) => ({
  path: `${DIR}/${relative("runner", p).replaceAll("\\", "/")}`,
  content: readFileSync(p),
}));

const sandbox = await Sandbox.create({
  source: { type: "snapshot", snapshotId: snap.snapshotId },
  region: snap.region,
  resources: { vcpus: 2 },
  persistent: false,
  timeout: 10 * 60_000,
});
try {
  await sandbox.writeFiles(files);
  const install = await sandbox.runCommand({ cmd: "uv", args: ["pip", "install", "--python", `${snap.venv}/bin/python`, "pytest"] });
  if (install.exitCode !== 0) throw new Error(await install.stderr());
  const test = await sandbox.runCommand({
    cmd: `${snap.venv}/bin/python`,
    args: ["-m", "pytest", "-v", "-rs"],
    sudo: true, // root, like the production server: privilege-drop tests run too
    cwd: DIR,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  process.exitCode = test.exitCode;
} finally {
  await sandbox.stop();
}

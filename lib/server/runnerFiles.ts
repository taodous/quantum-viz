/**
 * The Python runner (runner/qrunner/*.py), shipped into each sandbox when it
 * starts. next.config.ts traces these files into the /api functions.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RunnerFile = { path: string; content: Buffer };

let cached: { files: RunnerFile[]; version: string } | undefined;

/** Runner files plus a version hash (also covering the snapshot, so a new PennyLane means new sandboxes). */
export function runnerBundle(snapshotId: string): { files: RunnerFile[]; version: string } {
  if (cached) return cached;
  const dir = join(process.cwd(), "runner", "qrunner");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".py"))
    .sort()
    .map((f) => ({ path: `qrunner/${f}`, content: readFileSync(join(dir, f)) }));
  if (!files.some((f) => f.path === "qrunner/server.py")) throw new Error(`runner files not found in ${dir}`);
  const h = createHash("sha256").update(snapshotId);
  for (const f of files) h.update(f.path).update("\0").update(f.content).update("\0");
  cached = { files, version: h.digest("hex") };
  return cached;
}

/**
 * PoolBackend on top of Vercel Sandbox (@vercel/sandbox 3.9).
 *
 * Every sandbox: snapshot with PennyLane preinstalled, 1 vCPU, no outbound
 * network, no environment variable, not persistent. The runner server is
 * started as root so it can drop the student's code to `nobody`.
 */
import { APIError, Sandbox } from "@vercel/sandbox";

import type { ServerConfig } from "./config";
import { type PoolBackend, type RemoteSandbox, RUNNER_PORT } from "./pool";
import type { RunnerFile } from "./runnerFiles";

const RUNNER_DIR = "/vercel/sandbox/runner";
const ALIVE = new Set(["running", "pending"]);

const status = (e: unknown) => (e instanceof APIError ? e.response.status : null);

export function vercelBackend(cfg: ServerConfig, files: RunnerFile[]): PoolBackend {
  async function find(name: string): Promise<Sandbox | null> {
    try {
      return await Sandbox.get({ name, resume: false });
    } catch (e) {
      if (status(e) === 404) return null;
      throw e;
    }
  }

  function create(name: string) {
    return Sandbox.create({
      name,
      source: { type: "snapshot", snapshotId: cfg.snapshotId },
      region: cfg.region,
      resources: { vcpus: 1 },
      networkPolicy: "deny-all",
      persistent: false,
      ports: [RUNNER_PORT],
      timeout: cfg.sandboxTimeoutMs,
      tags: { app: "quantum-viz" },
    });
  }

  function wrap(sb: Sandbox): RemoteSandbox {
    return {
      name: sb.name,
      createdAt: sb.createdAt.getTime(),
      expiresAt: sb.expiresAt?.getTime() ?? sb.createdAt.getTime() + cfg.sandboxTimeoutMs,
      url: sb.domain(RUNNER_PORT),
      async startServer(tokenSha256) {
        await sb.writeFiles(files.map((f) => ({ path: `${RUNNER_DIR}/${f.path}`, content: f.content })));
        await sb.runCommand({
          cmd: `${cfg.venv}/bin/python`,
          args: ["-m", "qrunner.server", "--port", String(RUNNER_PORT), "--token-sha256", tokenSha256, "--user", "nobody"],
          cwd: RUNNER_DIR,
          sudo: true,
          detached: true,
        });
      },
      async stop() {
        await sb.stop();
      },
    };
  }

  return {
    async open(name, shouldCreate) {
      const found = await find(name);
      if (found && ALIVE.has(found.status)) return { sandbox: wrap(found), created: false };
      if (!shouldCreate) return null;
      if (found) await found.delete().catch(() => {}); // stopped or failed: free the name
      try {
        return { sandbox: wrap(await create(name)), created: true };
      } catch (e) {
        // Another instance created it a moment ago (the API answers 400
        // "already exists"): use theirs.
        const again = await find(name).catch(() => null);
        if (again && ALIVE.has(again.status)) return { sandbox: wrap(again), created: false };
        throw e;
      }
    },
  };
}

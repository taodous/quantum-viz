/**
 * Server configuration, read from environment variables.
 *
 * Production (Vercel project settings):
 *   SESSION_CODE         code given out in class (case and spaces ignored)
 *   SESSION_SECRET       long random string: signs cookies, derives sandbox tokens
 *   SANDBOX_SNAPSHOT_ID  snapshot with PennyLane (pnpm sandbox:snapshot)
 * Optional: SANDBOX_POOL_SIZE (2), SANDBOX_TIMEOUT_MS (45 min, the Hobby maximum),
 *   SANDBOX_REGION (cdg1), SANDBOX_VENV.
 *
 * In development, missing values fall back to safe local defaults (code
 * "quantum", snapshot from .sandbox/snapshot.json) so `pnpm dev` just works.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ServerConfig = {
  sessionCode: string;
  sessionSecret: string;
  snapshotId: string;
  region: string;
  venv: string;
  poolSize: number;
  sandboxTimeoutMs: number;
};

export class ConfigError extends Error {}

const DEV_SECRET = "dev-only-secret-never-use-in-production";

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer in [${min}, ${max}]`);
  return n;
}

function devSnapshot(): { snapshotId?: string; region?: string; venv?: string } {
  const file = join(process.cwd(), ".sandbox", "snapshot.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

let cached: ServerConfig | undefined;

export function serverConfig(): ServerConfig {
  if (cached) return cached;
  const prod = process.env.NODE_ENV === "production";
  const dev = prod ? {} : devSnapshot();

  const sessionCode = process.env.SESSION_CODE ?? (prod ? undefined : "quantum");
  const sessionSecret = process.env.SESSION_SECRET ?? (prod ? undefined : DEV_SECRET);
  const snapshotId = process.env.SANDBOX_SNAPSHOT_ID ?? dev.snapshotId;
  const missing = [!sessionCode && "SESSION_CODE", !sessionSecret && "SESSION_SECRET", !snapshotId && "SANDBOX_SNAPSHOT_ID"].filter(Boolean);
  if (missing.length) throw new ConfigError(`missing environment variables: ${missing.join(", ")}`);
  if (prod && sessionSecret!.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters");

  cached = {
    sessionCode: sessionCode!,
    sessionSecret: sessionSecret!,
    snapshotId: snapshotId!,
    region: process.env.SANDBOX_REGION ?? dev.region ?? "cdg1",
    venv: process.env.SANDBOX_VENV ?? dev.venv ?? "/vercel/sandbox/venv",
    poolSize: int("SANDBOX_POOL_SIZE", prod ? 2 : 1, 1, 4),
    sandboxTimeoutMs: int("SANDBOX_TIMEOUT_MS", 45 * 60_000, 5 * 60_000, 24 * 3600_000),
  };
  return cached;
}

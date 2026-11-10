/**
 * Per-instance singletons shared by the route handlers. Kept on globalThis so
 * that dev hot reloads do not start a second pool.
 */
import { serverConfig } from "./config";
import { Pool, poolPrefix } from "./pool";
import { TokenBucket } from "./rateLimit";
import { runnerBundle } from "./runnerFiles";
import { vercelBackend } from "./sandboxBackend";

type Services = { pool: Pool; runLimit: TokenBucket; loginLimit: TokenBucket };

const g = globalThis as typeof globalThis & { __hqServices?: Services };

export function services(): Services {
  if (g.__hqServices) return g.__hqServices;
  const cfg = serverConfig();
  const bundle = runnerBundle(cfg.snapshotId);
  const pool = new Pool({
    backend: vercelBackend(cfg, bundle.files),
    secret: cfg.sessionSecret,
    prefix: poolPrefix(bundle.version, cfg.sessionSecret),
    size: cfg.poolSize,
    sandboxTimeoutMs: cfg.sandboxTimeoutMs,
  });
  g.__hqServices = {
    pool,
    // A typing pause triggers a run: 20 in a burst, then one per second.
    runLimit: new TokenBucket(20, 1),
    // Session code attempts per IP: 8, then one every 10 s.
    loginLimit: new TokenBucket(8, 0.1),
  };
  return g.__hqServices;
}

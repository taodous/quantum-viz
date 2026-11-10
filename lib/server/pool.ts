/**
 * Pool of shared sandboxes, each running the pre-warmed runner server
 * (milestone 1: ~80 ms per run through the exposed port).
 *
 * Coordination without a database: time is cut into epochs (30 min) and the
 * sandboxes of epoch E have fixed names `<prefix>-<E>-<slot>`. Every function
 * instance computes the same names, so the first one to need a sandbox creates
 * it and the others find it by name (a name can only exist once).
 *
 * Lifecycle (Hobby plan: a sandbox lives at most 45 min):
 * - Sandboxes of epoch E+1 are created during the last minutes of epoch E, if
 *   there is traffic. Until they answer, epoch E's keep serving.
 * - A few minutes into epoch E+1, this instance stops the epoch E sandboxes it
 *   knows. The rest expire on their own (timeout).
 * - At most 2 × size sandboxes exist at once (Hobby: 10 concurrent).
 *
 * Each sandbox has its own bearer token, HMAC(secret, name): any instance can
 * derive it, the sandbox only receives its SHA-256.
 */
import { createHash, createHmac } from "node:crypto";

export const RUNNER_PORT = 7000;

export type Target = { name: string; url: string; token: string; expiresAt: number };

export interface RemoteSandbox {
  name: string;
  createdAt: number;
  expiresAt: number;
  /** public URL of the runner port */
  url: string;
  /** write the runner files and launch the server (detached) */
  startServer(tokenSha256: string): Promise<void>;
  stop(): Promise<void>;
}

export interface PoolBackend {
  /**
   * The running sandbox with this name. With `create`, make it when there is
   * none (or only a stopped one). `created`: this call made it.
   * null: no running sandbox and `create` is false.
   */
  open(name: string, create: boolean): Promise<{ sandbox: RemoteSandbox; created: boolean } | null>;
}

export class PoolUnavailableError extends Error {}

export type PoolOptions = {
  backend: PoolBackend;
  /** derives the per-sandbox tokens */
  secret: string;
  /** sandbox name prefix: runner version + key id, see poolPrefix() */
  prefix: string;
  size: number;
  /** sandbox lifetime, to size the epochs */
  sandboxTimeoutMs: number;
  prewarmMs?: number;
  retireAfterMs?: number;
  readyTimeoutMs?: number;
  /** a sandbox found running without an answering server gets one after this */
  serverStartGraceMs?: number;
  failureBackoffMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  probe?: (url: string) => Promise<boolean>;
  log?: (msg: string) => void;
};

export type AcquireOptions = {
  /** keeps background work (creation of other sandboxes) alive after the response */
  waitUntil?: (p: Promise<unknown>) => void;
  /** a sandbox that just failed: use another one if possible */
  avoid?: string;
  /** how long to wait for a sandbox to become ready */
  waitMs?: number;
};

type Slot = {
  name: string;
  epoch: number;
  promise: Promise<Target | null>;
  settled: boolean;
  target: Target | null;
  sandbox: RemoteSandbox | null;
  retryAt: number;
  retired: boolean;
};

const EXPIRY_MARGIN_MS = 60_000;

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** Names change with the runner code, the snapshot and the secret. */
export function poolPrefix(runnerVersion: string, secret: string): string {
  const keyId = createHmac("sha256", secret).update("pool-id").digest("hex").slice(0, 6);
  return `qv-${runnerVersion.slice(0, 8)}-${keyId}`;
}

export async function probeRunner(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2_500), cache: "no-store" });
    return res.ok && (await res.json()).ready === true;
  } catch {
    return false;
  }
}

export class Pool {
  readonly epochMs: number;
  private slots = new Map<string, Slot>();
  private rr = 0;
  private o: Required<PoolOptions>;

  constructor(opts: PoolOptions) {
    this.o = {
      prewarmMs: 3 * 60_000,
      retireAfterMs: 3 * 60_000,
      readyTimeoutMs: 40_000,
      serverStartGraceMs: 15_000,
      failureBackoffMs: 5_000,
      now: Date.now,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      probe: probeRunner,
      log: (m) => console.warn(`[pool] ${m}`),
      ...opts,
    };
    // A sandbox made ahead of its epoch must outlive the whole epoch.
    this.epochMs = Math.min(30 * 60_000, this.o.sandboxTimeoutMs - this.o.prewarmMs - 2 * EXPIRY_MARGIN_MS);
    if (this.epochMs < 60_000) throw new Error("sandbox timeout too short for the pool");
  }

  tokenFor(name: string): string {
    return createHmac("sha256", this.o.secret).update(`sandbox:${name}`).digest("hex");
  }

  names(epoch: number): string[] {
    return Array.from({ length: this.o.size }, (_, i) => `${this.o.prefix}-${epoch}-${i}`);
  }

  /** Make sure the current epoch's sandboxes exist (on login: warm the pool before the first run). */
  warm(opts: AcquireOptions = {}): Promise<unknown> {
    const e = Math.floor(this.o.now() / this.epochMs);
    return Promise.all(this.names(e).map((n) => this.slot(n, e, true, opts.waitUntil).promise));
  }

  async acquire(opts: AcquireOptions = {}): Promise<Target> {
    const now = this.o.now();
    const e = Math.floor(now / this.epochMs);
    const defer = opts.waitUntil;
    this.prune(e);

    const current = this.names(e).map((n) => this.slot(n, e, true, defer));
    if (now >= (e + 1) * this.epochMs - this.o.prewarmMs) this.names(e + 1).forEach((n) => this.slot(n, e + 1, true, defer));
    const usable = (s: Slot) => s.target !== null && !s.retired && s.target.expiresAt - now > EXPIRY_MARGIN_MS && s.name !== opts.avoid;

    let ready = current.filter(usable);
    let previous: Slot[] = [];
    if (ready.length === current.length && now - e * this.epochMs > this.o.retireAfterMs) this.retire(e, defer);
    if (ready.length < current.length) {
      // The new epoch is still starting: the previous one fills in.
      previous = this.names(e - 1).map((n) => this.slot(n, e - 1, false, defer));
      if (!ready.length) ready = previous.filter(usable);
    }
    if (ready.length) return ready[this.rr++ % ready.length].target!;

    const pending = [...current, ...previous].filter((s) => !s.settled && s.name !== opts.avoid);
    const target = await Promise.race([firstTarget(pending.map((s) => s.promise)), this.o.sleep(opts.waitMs ?? 25_000).then(() => null)]);
    if (!target) throw new PoolUnavailableError("no sandbox ready");
    return target;
  }

  /** A run on this target failed at the transport level: look at it again next time. */
  reportFailure(target: Target): void {
    const s = this.slots.get(target.name);
    if (s && s.target === target) {
      s.target = null;
      s.retryAt = this.o.now();
    }
  }

  /** Slot state for this name, (re)opening the sandbox when needed. */
  private slot(name: string, epoch: number, create: boolean, defer?: (p: Promise<unknown>) => void): Slot {
    const now = this.o.now();
    const existing = this.slots.get(name);
    if (existing && (existing.retired || existing.target || !existing.settled || now < existing.retryAt)) return existing;

    const slot: Slot = { name, epoch, settled: false, target: null, sandbox: null, retryAt: 0, retired: false, promise: null! };
    slot.promise = this.bring(name, create).then(
      (r) => {
        slot.settled = true;
        if (r) [slot.target, slot.sandbox] = [r.target, r.sandbox];
        else slot.retryAt = this.o.now() + this.o.failureBackoffMs;
        return slot.target;
      },
      (err: unknown) => {
        slot.settled = true;
        slot.retryAt = this.o.now() + this.o.failureBackoffMs;
        this.o.log(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      },
    );
    this.slots.set(name, slot);
    defer?.(slot.promise);
    return slot;
  }

  private async bring(name: string, create: boolean): Promise<{ target: Target; sandbox: RemoteSandbox } | null> {
    const opened = await this.o.backend.open(name, create);
    if (!opened) return null;
    const { sandbox, created } = opened;
    const token = this.tokenFor(name);
    const hash = sha256hex(token);
    let started = false;
    if (created) {
      await sandbox.startServer(hash);
      started = true;
    }
    const deadline = this.o.now() + this.o.readyTimeoutMs;
    while (this.o.now() < deadline) {
      if (await this.o.probe(sandbox.url)) return { target: { name, url: sandbox.url, token, expiresAt: sandbox.expiresAt }, sandbox };
      // Found running but silent long after creation: its creator died before
      // starting the server, or the server crashed. Start one (a duplicate
      // just fails to bind the port).
      if (!started && this.o.now() - sandbox.createdAt > this.o.serverStartGraceMs) {
        this.o.log(`${name}: no server answering, starting one`);
        await sandbox.startServer(hash);
        started = true;
      }
      await this.o.sleep(300);
    }
    this.o.log(`${name}: server not ready after ${this.o.readyTimeoutMs} ms`);
    return null;
  }

  /** Stop the older sandboxes this instance knows, once the current epoch fully serves. */
  private retire(epoch: number, defer?: (p: Promise<unknown>) => void) {
    for (const s of this.slots.values()) {
      if (s.epoch >= epoch || s.retired || !s.sandbox) continue;
      s.retired = true;
      s.target = null;
      const p = s.sandbox.stop().catch((err: unknown) => this.o.log(`${s.name}: stop failed: ${err instanceof Error ? err.message : err}`));
      defer?.(p);
    }
  }

  private prune(epoch: number) {
    for (const [name, s] of this.slots) if (s.epoch < epoch - 1 && s.settled) this.slots.delete(name);
  }
}

function firstTarget(ps: Promise<Target | null>[]): Promise<Target | null> {
  return new Promise((resolve) => {
    let left = ps.length;
    if (!left) return resolve(null);
    for (const p of ps)
      p.then((t) => {
        if (t) resolve(t);
        else if (--left === 0) resolve(null);
      });
  });
}

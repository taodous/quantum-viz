// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Pool, type PoolBackend, PoolUnavailableError, poolPrefix, type RemoteSandbox, sha256hex } from "./pool";

const MIN = 60_000;
const EPOCH = 30 * MIN;

class FakeSandbox implements RemoteSandbox {
  alive = true;
  serverUp = false;
  starts: string[] = [];
  createdAt = Date.now();
  expiresAt = Date.now() + 45 * MIN;
  url: string;
  constructor(
    public name: string,
    private bootMs: number,
  ) {
    this.url = `https://${name}.sandbox.test`;
  }
  async startServer(hash: string) {
    this.starts.push(hash);
    setTimeout(() => (this.serverUp = this.alive), this.bootMs);
  }
  async stop() {
    this.alive = false;
    this.serverUp = false;
  }
}

class FakeBackend implements PoolBackend {
  boxes = new Map<string, FakeSandbox>();
  created: string[] = [];
  bootMs = 3_000;
  failCreate = false;
  async open(name: string, create: boolean) {
    await Promise.resolve();
    const s = this.boxes.get(name);
    if (s?.alive) return { sandbox: s, created: false };
    if (!create) return null;
    if (this.failCreate) throw new Error("concurrency limit");
    const n = new FakeSandbox(name, this.bootMs);
    this.boxes.set(name, n);
    this.created.push(name);
    return { sandbox: n, created: true };
  }
  probe = async (url: string) => [...this.boxes.values()].some((b) => b.url === url && b.serverUp);
}

function makePool(backend: FakeBackend, size = 2) {
  return new Pool({ backend, secret: "s".repeat(40), prefix: "qv-test", size, sandboxTimeoutMs: 45 * MIN, probe: backend.probe, log: () => {} });
}

/** Run `p` while letting fake time flow. */
async function settle<T>(p: Promise<T>, ms = 60_000): Promise<T> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let t = 0; t < ms && !done; t += 100) await vi.advanceTimersByTimeAsync(100);
  return p;
}

const E0 = 1_000_000; // an epoch number
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(E0 * EPOCH + MIN);
});
afterEach(() => vi.useRealTimers());

describe("Pool", () => {
  it("names sandboxes by runner version, key and epoch", () => {
    expect(poolPrefix("abcdef0123456789", "secret")).toMatch(/^qv-abcdef01-[0-9a-f]{6}$/);
    expect(makePool(new FakeBackend()).names(7)).toEqual(["qv-test-7-0", "qv-test-7-1"]);
  });

  it("creates the epoch's sandboxes on first use and waits for their server", async () => {
    const backend = new FakeBackend();
    const pool = makePool(backend);
    const t0 = Date.now();
    const target = await settle(pool.acquire());
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3_000);
    expect(backend.created.sort()).toEqual([`qv-test-${E0}-0`, `qv-test-${E0}-1`]);
    // The sandbox only ever sees the token's hash.
    const box = backend.boxes.get(target.name)!;
    expect(target.token).toBe(pool.tokenFor(target.name));
    expect(box.starts).toEqual([sha256hex(target.token)]);
  });

  it("then answers at once, spreading runs over the sandboxes", async () => {
    const backend = new FakeBackend();
    const pool = makePool(backend);
    await settle(pool.warm());
    const names = new Set<string>();
    for (let i = 0; i < 4; i++) names.add((await pool.acquire()).name);
    expect(names.size).toBe(2);
  });

  it("another function instance reuses the same sandboxes", async () => {
    const backend = new FakeBackend();
    await settle(makePool(backend).warm());
    const other = makePool(backend);
    const target = await settle(other.acquire());
    expect(backend.created).toHaveLength(2);
    expect(backend.boxes.get(target.name)!.starts).toHaveLength(1);
    expect(target.token).toBe(makePool(backend).tokenFor(target.name)); // same secret, same token
  });

  it("starts the server of a sandbox whose creator died before doing it", async () => {
    const backend = new FakeBackend();
    const orphan = new FakeSandbox(`qv-test-${E0}-0`, 3_000);
    orphan.createdAt -= 60_000;
    backend.boxes.set(orphan.name, orphan);
    const pool = makePool(backend, 1);
    const target = await settle(pool.acquire());
    expect(target.name).toBe(orphan.name);
    expect(orphan.starts).toHaveLength(1);
  });

  it("prepares the next epoch ahead, keeps serving from the old one until it answers, then retires it", async () => {
    const backend = new FakeBackend();
    const pool = makePool(backend, 1);
    const old = await settle(pool.acquire());

    const next = `qv-test-${E0 + 1}-0`;
    vi.setSystemTime((E0 + 1) * EPOCH - 20_000); // in the prewarm window
    backend.bootMs = 35_000;
    expect((await pool.acquire()).name).toBe(old.name);
    expect(backend.created).toContain(next);

    await vi.advanceTimersByTimeAsync(25_000); // new epoch, its sandbox still booting
    expect((await pool.acquire()).name).toBe(old.name);

    await vi.advanceTimersByTimeAsync(15_000); // the new server answers
    expect((await pool.acquire()).name).toBe(next);
    expect(backend.boxes.get(old.name)!.alive).toBe(true); // others may still use it

    await vi.advanceTimersByTimeAsync(3 * MIN);
    expect((await pool.acquire()).name).toBe(next);
    expect(backend.boxes.get(old.name)!.alive).toBe(false);
  });

  it("looks again at a sandbox after a failed run", async () => {
    const backend = new FakeBackend();
    const pool = makePool(backend, 1);
    const target = await settle(pool.acquire());
    backend.boxes.get(target.name)!.alive = false; // expired early
    pool.reportFailure(target);
    const next = await settle(pool.acquire());
    expect(next.name).toBe(target.name);
    expect(backend.created).toHaveLength(2); // recreated under the same name
  });

  it("gives up quickly when sandboxes cannot be created", async () => {
    const backend = new FakeBackend();
    backend.failCreate = true;
    await expect(settle(makePool(backend).acquire())).rejects.toBeInstanceOf(PoolUnavailableError);
  });
});

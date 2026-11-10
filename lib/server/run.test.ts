// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { FIXTURES } from "@/lib/circuit/fixtures";

import { PoolUnavailableError, type Target } from "./pool";
import { INFRA_DOWN, parseRunResponse, runOnPool } from "./run";

const bell = FIXTURES["07_bell"].response;
const t = (name: string): Target => ({ name, url: `https://${name}.test`, token: `tok-${name}`, expiresAt: Date.now() + 1e6 });

function fakePool(targets: Target[]) {
  const failed: string[] = [];
  return {
    failed,
    acquire: vi.fn(async ({ avoid }: { avoid?: string } = {}) => targets.find((x) => x.name !== avoid) ?? targets[0]),
    reportFailure: vi.fn((x: Target) => void failed.push(x.name)),
  };
}

describe("runOnPool", () => {
  it("sends the code with the sandbox's token and passes the answer through", async () => {
    const pool = fakePool([t("a")]);
    const fetch = vi.fn(async () => new Response(JSON.stringify(bell), { status: 200 }));
    const r = await runOnPool(pool, "code", { fetch });
    expect(r).toEqual({ status: 200, body: bell });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://a.test");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-a");
    expect(init.body).toBe("code");
  });

  it("a student error is a normal answer", async () => {
    const pool = fakePool([t("a")]);
    const err = FIXTURES["e1_syntax"].response;
    const r = await runOnPool(pool, "x = (", { fetch: async () => new Response(JSON.stringify(err)) });
    expect(r).toEqual({ status: 200, body: err });
  });

  it("retries once on another sandbox when one is gone", async () => {
    const pool = fakePool([t("a"), t("b")]);
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("a.test")) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(bell));
    });
    const r = await runOnPool(pool, "code", { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(r.status).toBe(200);
    expect(pool.failed).toEqual(["a"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("anything but our runner's JSON is an infrastructure failure", async () => {
    const pool = fakePool([t("a"), t("b")]);
    const r = await runOnPool(pool, "code", { fetch: async () => new Response("<html>502</html>", { status: 502 }) });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: { kind: "infra", message: INFRA_DOWN } });
    expect(pool.failed).toEqual(["a", "b"]);
  });

  it("no sandbox ready: 503 with the French message", async () => {
    const pool = { acquire: async () => Promise.reject(new PoolUnavailableError("x")), reportFailure: () => {} };
    const r = await runOnPool(pool, "code", { fetch: async () => new Response() });
    expect(r).toMatchObject({ status: 503, body: { ok: false, error: { kind: "infra", message: INFRA_DOWN } } });
  });
});

describe("parseRunResponse", () => {
  it("accepts the contract's two shapes only", () => {
    expect(parseRunResponse(JSON.stringify(bell))).toEqual(bell);
    expect(parseRunResponse(JSON.stringify(FIXTURES["e2_wire"].response))).not.toBeNull();
    expect(parseRunResponse('{"ready": true}')).toBeNull();
    expect(parseRunResponse('{"ok": false}')).toBeNull();
    expect(parseRunResponse("not json")).toBeNull();
  });
});

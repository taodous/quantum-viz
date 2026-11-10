import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIXTURES } from "@/lib/circuit/fixtures";
import type { RunResponse } from "@/lib/circuit/types";

import { CONNECTION_LOST, RUN_DEBOUNCE_MS, useRun } from "./useRun";

const bell = FIXTURES["07_bell"];
const hadamard = FIXTURES["03_hadamard"];
const syntax = FIXTURES["e1_syntax"].response;

type Reply = { status?: number; body: RunResponse | string; delay?: number };

function mockFetch(replies: (code: string) => Reply) {
  const calls: string[] = [];
  const fn = vi.fn((_url: string, init: RequestInit) => {
    const code = JSON.parse(init.body as string).code as string;
    calls.push(code);
    const r = replies(code);
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 })),
        r.delay ?? 50,
      );
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const flush = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useRun", () => {
  it("draws the known answer for the starter code without running it", async () => {
    const calls = mockFetch(() => ({ body: bell.response }));
    const { result } = renderHook(() => useRun(bell.code, { enabled: true, initial: bell }));
    await flush(1000);
    expect(calls).toEqual([]);
    expect(result.current.good?.circuits).toHaveLength(2);
  });

  it("runs after a typing pause, only for the last code", async () => {
    const calls = mockFetch((code) => ({ body: code === hadamard.code ? hadamard.response : bell.response }));
    const { result, rerender } = renderHook(({ code }) => useRun(code, { enabled: true }), { initialProps: { code: "a" } });
    rerender({ code: "ab" });
    await flush(RUN_DEBOUNCE_MS / 2);
    rerender({ code: hadamard.code });
    await flush(RUN_DEBOUNCE_MS + 100);
    expect(calls).toEqual([hadamard.code]);
    expect(result.current.good?.circuits[0].name).toBe(hadamard.response.ok && hadamard.response.circuits[0].name);
  });

  it("an answer to an older request never replaces a newer one", async () => {
    const calls = mockFetch((code) => ({ body: code === "slow" ? bell.response : hadamard.response, delay: code === "slow" ? 2000 : 50 }));
    const { result, rerender } = renderHook(({ code }) => useRun(code, { enabled: true }), { initialProps: { code: "slow" } });
    await flush(RUN_DEBOUNCE_MS + 10); // "slow" is in flight
    rerender({ code: "fast" });
    await flush(3000);
    expect(calls).toEqual(["slow", "fast"]);
    expect(result.current.good?.circuits).toEqual(hadamard.response.ok && hadamard.response.circuits);
  });

  it("keeps the last good circuit when the code breaks", async () => {
    mockFetch((code) => ({ body: code === "bad" ? syntax : bell.response }));
    const { result, rerender } = renderHook(({ code }) => useRun(code, { enabled: true }), { initialProps: { code: "good" } });
    await flush(1000);
    rerender({ code: "bad" });
    await flush(1000);
    expect(result.current.good?.circuits).toHaveLength(2);
    expect(result.current.error).toEqual(!syntax.ok && syntax.error);
  });

  it("connection lost: says so, keeps the circuit, retries by itself", async () => {
    let online = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(bell.response));
    }));
    const { result } = renderHook(() => useRun("code", { enabled: true }));
    await flush(RUN_DEBOUNCE_MS + 10);
    expect(result.current.error).toEqual(CONNECTION_LOST);
    online = true;
    await flush(3500); // the retry timer fires; React renders when act() ends
    await flush(100); // …then the retried request goes out
    expect(result.current.error).toBeNull();
    expect(result.current.good?.circuits).toHaveLength(2);
  });

  it("asks for the session code on 401", async () => {
    mockFetch(() => ({ status: 401, body: { ok: false, error: { kind: "infra", message: "x", line: null, python: null } } }));
    const lost = vi.fn();
    const { result } = renderHook(() => useRun("code", { enabled: true, onSessionLost: lost }));
    await flush(1000);
    expect(result.current.needSession).toBe(true);
    expect(lost).toHaveBeenCalled();
  });

  it("does nothing while disabled (no session yet)", async () => {
    const calls = mockFetch(() => ({ body: bell.response }));
    renderHook(() => useRun("code", { enabled: false }));
    await flush(2000);
    expect(calls).toEqual([]);
  });
});

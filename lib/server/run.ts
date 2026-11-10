/**
 * /api/run's core: send the student's code to a pooled sandbox, always come
 * back with a RunResponse. HTTP status: 200 for anything the runner answered
 * (student errors included), 503 when no sandbox could run it.
 */
import type { RunError, RunResponse } from "@/lib/circuit/types";

import { type AcquireOptions, type Pool, PoolUnavailableError, type Target } from "./pool";

export const MAX_CODE_CHARS = 20_000; // same as runner/qrunner/limits.py
/** The runner stops student code at 5 s; past this the sandbox itself is in trouble. */
export const RUN_TIMEOUT_MS = 9_000;

export type RunResult = { status: number; body: RunResponse };

export const runError = (kind: RunError["kind"], message: string, python: string | null = null): RunResponse => ({
  ok: false,
  error: { kind, message, line: null, python },
});

export const INFRA_DOWN = "Le serveur d'exécution ne répond pas. Nouvel essai…";

type PoolLike = Pick<Pool, "acquire" | "reportFailure">;

export async function runOnPool(
  pool: PoolLike,
  code: string,
  opts: { signal?: AbortSignal; waitUntil?: AcquireOptions["waitUntil"]; fetch?: typeof fetch } = {},
): Promise<RunResult> {
  const doFetch = opts.fetch ?? fetch;
  let avoid: string | undefined;
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let target: Target;
    try {
      target = await pool.acquire({ waitUntil: opts.waitUntil, avoid });
    } catch (e) {
      if (e instanceof PoolUnavailableError) return { status: 503, body: runError("infra", INFRA_DOWN, "aucun bac à sable prêt") };
      throw e;
    }
    const started = Date.now();
    try {
      const signals = [AbortSignal.timeout(RUN_TIMEOUT_MS), ...(opts.signal ? [opts.signal] : [])];
      const res = await doFetch(target.url, {
        method: "POST",
        body: code,
        headers: { authorization: `Bearer ${target.token}`, "content-type": "text/plain; charset=utf-8" },
        signal: AbortSignal.any(signals),
        cache: "no-store",
      });
      if (res.status === 200) {
        const body = parseRunResponse(await res.text());
        if (body) return { status: 200, body };
        lastProblem = "réponse illisible";
      } else {
        lastProblem = `HTTP ${res.status}`;
      }
    } catch (e) {
      if (opts.signal?.aborted) throw e; // the browser gave up: nobody to answer
      const timedOut = Date.now() - started >= RUN_TIMEOUT_MS - 50;
      pool.reportFailure(target);
      if (timedOut) return { status: 503, body: runError("infra", INFRA_DOWN, `pas de réponse après ${RUN_TIMEOUT_MS / 1000} s`) };
      lastProblem = e instanceof Error ? e.message : String(e);
      avoid = target.name;
      continue;
    }
    pool.reportFailure(target);
    avoid = target.name;
  }
  return { status: 503, body: runError("infra", INFRA_DOWN, lastProblem || null) };
}

/** Light shape check: anything else means the sandbox is not our runner. */
export function parseRunResponse(text: string): RunResponse | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.ok === true && Array.isArray(r.circuits)) return v as RunResponse;
  if (r.ok === false && r.error && typeof r.error === "object" && typeof (r.error as RunError).message === "string") return v as RunResponse;
  return null;
}

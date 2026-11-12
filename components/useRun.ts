"use client";

import { useEffect, useRef, useState } from "react";

import type { Circuit, RunError, RunResponse } from "@/lib/circuit/types";

/** Pause in typing before the code runs. */
export const RUN_DEBOUNCE_MS = 450;
const CLIENT_TIMEOUT_MS = 45_000;
const MAX_AUTO_RETRIES = 4;

export const CONNECTION_LOST: RunError = { kind: "infra", message: "Connexion perdue. Ton code est conservé.", line: null, python: null };

export type GoodRun = { code: string; circuits: Circuit[]; hint: string | null };

export type RunState = {
  /** last successful answer, and the code it answers: what the circuit panel draws */
  good: GoodRun | null;
  /** error to show over the (greyed) last good circuit */
  error: RunError | null;
  busy: boolean;
  /** the server wants the session code (none yet, or expired) */
  needSession: boolean;
};

type Options = {
  enabled: boolean;
  /**
   * An answer already known (no run needed for its code). When it changes, its
   * circuit replaces the one on screen: after a reload, the last valid circuit
   * saved in the browser stays visible even if the restored code is broken.
   */
  initial?: { code: string; response: RunResponse };
  onSessionLost?: () => void;
};

/**
 * Runs the code after each typing pause, through /api/run. Only the answer to
 * the latest request is shown: older requests are aborted. Infrastructure
 * failures (no sandbox, connection lost) are retried automatically.
 */
export function useRun(code: string, { enabled, initial, onSessionLost }: Options): RunState {
  const [state, setState] = useState<RunState>(() => {
    const r = initial?.code === code ? initial.response : null;
    return { good: r?.ok ? { code, circuits: r.circuits, hint: r.hint } : null, error: r && !r.ok ? r.error : null, busy: false, needSession: false };
  });
  const [retry, setRetry] = useState(0); // bumping it re-runs the same code
  const retryNow = useRef(false);
  const skipFor = useRef<string | null>(initial?.code === code ? code : null);
  const seq = useRef(0);
  const retries = useRef({ code: "", n: 0 });
  const lost = useRef(onSessionLost);
  useEffect(() => {
    lost.current = onSessionLost;
  });

  // A new known answer (declared before the run effect, so its skip applies to this same commit).
  const seeded = useRef(initial);
  useEffect(() => {
    if (!initial || initial === seeded.current) return;
    seeded.current = initial;
    const r = initial.response;
    if (r.ok) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the known answer comes from localStorage, after hydration
      setState((s) => ({ ...s, good: { code: initial.code, circuits: r.circuits, hint: r.hint } }));
      if (initial.code === code) skipFor.current = code;
    }
  }, [initial, code]);

  useEffect(() => {
    if (!enabled) return;
    const isRetry = retryNow.current;
    retryNow.current = false;
    if (skipFor.current === code && !isRetry) return; // answer already on screen
    skipFor.current = null;
    if (retries.current.code !== code) retries.current = { code, n: 0 };

    const ctrl = new AbortController();
    const id = ++seq.current;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRetry = (ms: number) => {
      if (retries.current.n >= MAX_AUTO_RETRIES) return;
      retries.current.n++;
      retryTimer = setTimeout(() => {
        retryNow.current = true;
        setRetry((r) => r + 1);
      }, ms);
    };
    const settle = (patch: Partial<RunState>) => {
      if (id === seq.current) setState((s) => ({ ...s, busy: false, ...patch }));
    };

    const timer = setTimeout(async () => {
      setState((s) => (s.busy ? s : { ...s, busy: true }));
      let res: Response;
      let body: RunResponse | null = null;
      try {
        res = await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code }),
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(CLIENT_TIMEOUT_MS)]),
        });
        body = (await res.json().catch(() => null)) as RunResponse | null;
      } catch {
        if (ctrl.signal.aborted) return; // superseded by a newer run
        settle({ error: CONNECTION_LOST });
        scheduleRetry(3_000);
        return;
      }
      if (id !== seq.current) return;
      if (res.status === 401) {
        settle({ needSession: true });
        lost.current?.();
        return;
      }
      if (!body || typeof body.ok !== "boolean") {
        settle({ error: CONNECTION_LOST });
        scheduleRetry(3_000);
        return;
      }
      if (body.ok) {
        settle({ good: { code, circuits: body.circuits, hint: body.hint }, error: null, needSession: false });
        return;
      }
      settle({ error: body.error, needSession: false });
      if (res.status === 503) scheduleRetry(2_000 * 2 ** retries.current.n);
      if (res.status === 429) scheduleRetry(1_000 * Number(res.headers.get("retry-after") ?? 2));
    }, isRetry ? 0 : RUN_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      ctrl.abort();
    };
  }, [code, enabled, retry]);

  return state;
}

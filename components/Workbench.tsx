"use client";

import { useCallback, useEffect, useState } from "react";

import { gateCount, layout } from "@/lib/circuit/layout";
import type { Fixture } from "@/lib/circuit/types";

import { CircuitScene } from "./CircuitScene";
import { CodeEditor } from "./CodeEditor";
import { ErrorCard } from "./ErrorCard";
import { SessionGate } from "./SessionGate";
import { Sky } from "./Sky";
import { useRun } from "./useRun";
import { useTextMeasure } from "./useTextMeasure";

type Props = {
  /** the session cookie was valid when the page was rendered */
  authed: boolean;
  /** starting code, and the runner's answer for it (drawn before any run) */
  starter: Fixture;
  /** restore the code saved in this browser (off when a fixture is opened in dev) */
  restore?: boolean;
};

const STORAGE_KEY = "hello-quantum:code";

const plural = (n: number, w: string) => (
  <>
    <b>{n}</b> {w}
    {n > 1 ? "s" : ""}
  </>
);

function loadCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveCode(code: string) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // private mode or storage full: nothing else to do
  }
}

export function Workbench({ authed, starter, restore = true }: Props) {
  const measure = useTextMeasure();
  const [code, setCode] = useState(starter.code);
  const [restored, setRestored] = useState(false);
  const [open, setOpen] = useState(authed);
  const [expired, setExpired] = useState(false);
  const [selected, setSelected] = useState(0);
  const [caretLine, setCaretLine] = useState(0);
  const [hoverLine, setHoverLine] = useState(0);

  // The student's code survives reloads and outages: restore it, save every keystroke.
  useEffect(() => {
    const stored = restore ? loadCode() : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after hydration
    if (stored !== null && stored.trim()) setCode(stored);
    setRestored(true);
  }, [restore]);
  const onChange = useCallback((v: string) => {
    setCode(v);
    saveCode(v);
  }, []);

  const onSessionLost = useCallback(() => {
    setOpen(false);
    setExpired(true);
  }, []);
  const run = useRun(code, { enabled: open && restored, initial: starter, onSessionLost });

  const circuits = run.good?.circuits ?? [];
  const error = open ? run.error : null;
  const index = Math.min(selected, Math.max(0, circuits.length - 1));
  const circuit = circuits[index] ?? null;
  const L = circuit && circuit.wires.length ? layout(circuit, measure) : null;
  const hint = run.good?.hint ?? (run.busy ? "Exécution…" : undefined);

  const pill = !open
    ? { cls: "", text: "code de séance" }
    : run.busy
      ? { cls: " busy", text: "exécution…" }
      : error
        ? { cls: " bad", text: error.kind === "infra" ? "serveur indisponible" : "code à corriger" }
        : { cls: "", text: "PennyLane · en direct" };
  const studentError = error && error.kind !== "infra" ? error : null;

  return (
    <>
      <Sky />
      <div className="app">
        <header>
          <svg className="mark" viewBox="0 0 26 26" aria-hidden="true">
            <ellipse cx="13" cy="13" rx="11" ry="4.6" fill="none" stroke="var(--ice)" strokeWidth="1.1" opacity=".85" transform="rotate(-28 13 13)" />
            <ellipse cx="13" cy="13" rx="11" ry="4.6" fill="none" stroke="var(--iris)" strokeWidth="1.1" opacity=".7" transform="rotate(38 13 13)" />
            <circle cx="13" cy="13" r="2.3" fill="var(--text)" />
          </svg>
          <h1>Hello Quantum</h1>
          <span className="sub">Workshop 1 · du code PennyLane au circuit</span>
          <span className={`pill${pill.cls}`} aria-live="polite">
            <i />
            <span>{pill.text}</span>
          </span>
        </header>
        <main>
          <section className="panel editor" aria-label="Code Python">
            <div className="bar">
              <b>circuit.py</b>
              <span className="hint">le schéma suit ce que tu écris</span>
            </div>
            <CodeEditor value={code} onChange={onChange} hoverLine={hoverLine} errorLine={studentError?.line ?? 0} onCaretLine={setCaretLine} />
            <div className={`foot${studentError ? " bad" : ""}`}>
              <span>{studentError ? (studentError.line ? `Ligne ${studentError.line} à corriger` : "Code à corriger") : "Python · PennyLane"}</span>
            </div>
          </section>
          <section className="panel stage" aria-label="Circuit quantique">
            <div className="bar">
              <div className="chips">
                {circuits.length ? (
                  circuits.map((c, i) => (
                    <button key={`${i}-${c.label}`} className="chip" type="button" aria-pressed={i === index} onClick={() => setSelected(i)}>
                      {c.label}
                    </button>
                  ))
                ) : (
                  <span>circuit</span>
                )}
              </div>
            </div>
            <div className="stage-body">
              <CircuitScene
                circuit={circuit}
                tabKey={`${index}:${circuit?.name ?? ""}`}
                measure={measure}
                caretLine={caretLine}
                onHoverLine={setHoverLine}
                stale={!!error || !open}
                emptyText={hint}
              />
              {!open ? (
                <div className="overlay">
                  <SessionGate onOpen={() => setOpen(true)} expired={expired} />
                </div>
              ) : error ? (
                <div className="overlay">
                  <ErrorCard error={error} />
                </div>
              ) : null}
            </div>
            <div className="bar stats">
              {circuit && L ? (
                <>
                  <span>{plural(circuit.wires.length, "qubit")}</span>
                  <span>{plural(gateCount(circuit), "porte")}</span>
                  <span>
                    profondeur <b>{L.depth}</b>
                  </span>
                  {circuit.shots ? <span>{plural(circuit.shots, "shot")}</span> : null}
                </>
              ) : (
                <span>en attente d&apos;un circuit</span>
              )}
            </div>
          </section>
        </main>
      </div>
    </>
  );
}

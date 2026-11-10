"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { gateCount, layout } from "@/lib/circuit/layout";
import type { Circuit, Fixture } from "@/lib/circuit/types";

import { CircuitScene } from "./CircuitScene";
import { CodeEditor } from "./CodeEditor";
import { Sky } from "./Sky";
import { useTextMeasure } from "./useTextMeasure";

type Props = {
  /** Milestone 3: the screen is fed by runner fixtures; live execution comes with /api/run. */
  fixture: Fixture;
  fixtureNames: string[];
};

const plural = (n: number, w: string) => (
  <>
    <b>{n}</b> {w}
    {n > 1 ? "s" : ""}
  </>
);

export function Workbench({ fixture, fixtureNames }: Props) {
  const router = useRouter();
  const measure = useTextMeasure();
  const [code, setCode] = useState(fixture.code);
  const [selected, setSelected] = useState(0);
  const [caretLine, setCaretLine] = useState(0);
  const [hoverLine, setHoverLine] = useState(0);

  const response = fixture.response;
  const circuits: Circuit[] = response.ok ? response.circuits : [];
  const error = response.ok ? null : response.error;
  const index = Math.min(selected, Math.max(0, circuits.length - 1));
  const circuit = circuits[index] ?? null;
  const L = circuit && circuit.wires.length ? layout(circuit, measure) : null;
  const hint = response.ok ? response.hint : null;

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
          <span className={`pill${error ? " bad" : ""}`}>
            <i />
            <span>{error ? "code à corriger" : "PennyLane · en direct"}</span>
          </span>
          <select
            className="fixture-pick"
            aria-label="Exemple de test"
            value={fixture.name}
            onChange={(e) => router.push(`/?f=${encodeURIComponent(e.target.value)}`)}
          >
            {fixtureNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </header>
        <main>
          <section className="panel editor" aria-label="Code Python">
            <div className="bar">
              <b>circuit.py</b>
              <span className="hint">le schéma suit ce que tu écris</span>
            </div>
            <CodeEditor value={code} onChange={setCode} hoverLine={hoverLine} errorLine={error?.line ?? 0} onCaretLine={setCaretLine} />
            <div className={`foot${error ? " bad" : ""}`}>
              <span>{error ? `${error.line ? `Ligne ${error.line} · ` : ""}${error.message}` : "Python · PennyLane"}</span>
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
            <CircuitScene
              circuit={circuit}
              tabKey={`${fixture.name}:${index}`}
              measure={measure}
              caretLine={caretLine}
              onHoverLine={setHoverLine}
              stale={!!error}
              emptyText={hint ?? undefined}
            />
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

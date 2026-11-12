import type { CSSProperties } from "react";

import { COMPACT_BARS, COMPACT_MIN_LABEL, fmtPercent, histogramCaption, ket } from "@/lib/circuit/histogram";
import type { Circuit } from "@/lib/circuit/types";

type Props = {
  circuit: Circuit;
  stale?: boolean;
};

/**
 * Measurement histogram, under the circuit. One bar per basis state, zeros
 * included, on an absolute 0–100 % scale (50/50 reads as two half bars).
 */
export function Histogram({ circuit, stale }: Props) {
  const bars = circuit.histogram;
  if (!bars?.length) return null;
  const { title, detail } = histogramCaption(circuit);
  const compact = bars.length > COMPACT_BARS;
  return (
    <figure className={`histo${stale ? " stale" : ""}${compact ? " compact" : ""}`} aria-label={`Histogramme : ${title}`}>
      <figcaption title={detail}>{title}</figcaption>
      <ol className="h-bars">
        {bars.map(({ state, value }) => {
          const pct = fmtPercent(value);
          const v = Math.max(0, Math.min(1, value));
          const showPct = !compact || v >= COMPACT_MIN_LABEL;
          return (
            <li key={state} className={v > 0 ? undefined : "zero"} title={`${ket(state)} : ${pct}`} aria-label={`${ket(state)} : ${pct}`}>
              <span className="h-track" style={{ "--v": v } as CSSProperties}>
                <span className="h-fill" />
                {showPct ? <span className="h-pct">{pct}</span> : null}
              </span>
              {compact ? null : <span className="h-ket">{ket(state)}</span>}
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

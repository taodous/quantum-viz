/** Histogram under the circuit: labels and percentages (pure, tested). */
import type { Circuit } from "./types";

/** Past this many bars (5 qubits and more) only the larger bars keep their labels. */
export const COMPACT_BARS = 16;
/** In compact mode, bars below this share carry no percentage. */
export const COMPACT_MIN_LABEL = 0.05;

const NNBSP = " "; // French: narrow no-break space before %

/**
 * "49,3 %", "50 %", "0 %". A tiny but real share never reads as 0 %:
 * in class, "never |01⟩" must be visible, and so must "almost never".
 */
export function fmtPercent(v: number): string {
  if (!(v > 0)) return `0${NNBSP}%`;
  if (v < 0.001) return `<${NNBSP}0,1${NNBSP}%`;
  const p = Math.round(v * 1000) / 10;
  if (p >= 100 && v < 1) return `>${NNBSP}99,9${NNBSP}%`;
  return `${Number.isInteger(p) ? p : p.toFixed(1).replace(".", ",")}${NNBSP}%`;
}

export const ket = (state: string) => `|${state}⟩`;

/** What the bars are, in a few words. */
export function histogramCaption(c: Pick<Circuit, "histogramKind" | "shots">): { title: string; detail: string } {
  switch (c.histogramKind) {
    case "counts":
      return {
        title: c.shots ? `résultats sur ${c.shots} mesures` : "résultats des mesures",
        detail: "Fréquence de chaque résultat, observée en exécutant le circuit plusieurs fois (shots).",
      };
    case "probs":
      return { title: "probabilités", detail: "Probabilité de chaque résultat, calculée exactement par PennyLane." };
    default:
      return {
        title: "probabilités théoriques",
        detail: "Le circuit ne renvoie ni counts, ni sample, ni probs : voici les probabilités de chaque résultat si on mesurait tous les qubits.",
      };
  }
}

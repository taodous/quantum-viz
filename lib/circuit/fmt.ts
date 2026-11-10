/**
 * Display formatting, ported from the prototype. The runner already formats
 * gate parameters (runner/qrunner/fmt.py, same rules); this is for values the
 * UI formats itself, and must stay identical to the Python version.
 */

const GREEK: Record<string, string> = {
  theta: "θ", phi: "φ", varphi: "φ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", lambda: "λ", lam: "λ",
  lmbda: "λ", omega: "ω", psi: "ψ", epsilon: "ε", eps: "ε", mu: "μ", tau: "τ", sigma: "σ", eta: "η",
  rho: "ρ", chi: "χ", xi: "ξ", zeta: "ζ", kappa: "κ", nu: "ν",
};
const SUBS = "₀₁₂₃₄₅₆₇₈₉";
const sub = (d: string) => [...d].map((c) => SUBS[+c] ?? c).join("");

/** theta → θ, phi_1 → φ₁ */
export function pretty(name: string): string {
  const m = /^([A-Za-z]+?)_?(\d+)?$/.exec(name);
  if (!m) return name;
  return (GREEK[m[1].toLowerCase()] ?? m[1]) + (m[2] ? sub(m[2]) : "");
}

/** Multiples of π as fractions (π/4, 2π/3), otherwise 3 decimals. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? "∞" : v < 0 ? "−∞" : "?";
  if (Number.isInteger(v)) return String(v).replace("-", "−");
  const r = v / Math.PI;
  for (const q of [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    const pn = r * q;
    const pr = Math.round(pn);
    if (pr !== 0 && Math.abs(pn - pr) < 1e-9) {
      const a = Math.abs(pr);
      return (pr < 0 ? "−" : "") + (a === 1 ? "" : a) + "π" + (q === 1 ? "" : "/" + q);
    }
  }
  let s = Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s.replace("-", "−");
}

/** Wire label as written in code: "#0" → 0, "$a" → a */
export function wireLabel(key: string): string {
  return key.slice(1);
}

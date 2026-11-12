import { describe, expect, it } from "vitest";

import { fmtPercent, histogramCaption, ket } from "./histogram";

const n = (s: string) => s.replace(/ /g, " ");

describe("fmtPercent", () => {
  it("French format, one decimal at most", () => {
    expect(n(fmtPercent(0.5))).toBe("50 %");
    expect(n(fmtPercent(1))).toBe("100 %");
    expect(n(fmtPercent(0.493))).toBe("49,3 %");
    expect(n(fmtPercent(0.1464))).toBe("14,6 %");
    expect(n(fmtPercent(0.0703))).toBe("7 %");
  });

  it("zero is 0 %, but a tiny real share never reads as 0 % or 100 %", () => {
    expect(n(fmtPercent(0))).toBe("0 %");
    expect(n(fmtPercent(1e-9))).toBe("< 0,1 %");
    expect(n(fmtPercent(0.99996))).toBe("> 99,9 %");
  });

  it("garbage reads as 0 %", () => {
    expect(n(fmtPercent(Number.NaN))).toBe("0 %");
    expect(n(fmtPercent(-0.2))).toBe("0 %");
  });
});

describe("histogramCaption", () => {
  it("says what the bars are", () => {
    expect(histogramCaption({ histogramKind: "counts", shots: 1000 }).title).toBe("résultats sur 1000 mesures");
    expect(histogramCaption({ histogramKind: "probs", shots: null }).title).toBe("probabilités");
    expect(histogramCaption({ histogramKind: "theory", shots: null }).title).toBe("probabilités théoriques");
  });

  it("kets", () => expect(ket("01")).toBe("|01⟩"));
});

import { describe, expect, it } from "vitest";

import { FIXTURES } from "./fixtures";
import { GEO, approxMeasure, circuitSig, gateCount, itemKey, layout, widthOf } from "./layout";
import type { Circuit } from "./types";

function circuits(name: string): Circuit[] {
  const r = FIXTURES[name].response;
  if (!r.ok) throw new Error(`${name} is an error fixture`);
  return r.circuits;
}

describe("layout", () => {
  it("places the Bell state gates in successive columns, then the measurement", () => {
    const [bell] = circuits("00_default");
    const L = layout(bell);
    expect(L.n).toBe(2);
    expect(L.items.map((it) => [it.op.name, it.col, it.lo, it.hi])).toEqual([
      ["Hadamard", 0, 0, 0],
      ["CNOT", 1, 0, 1],
      ["counts", 2, 0, 1],
    ]);
    expect(L.depth).toBe(2);
    // the measured wires become classical (double line) from the meter onward
    expect(L.measX).toEqual([L.colX[2], L.colX[2]]);
    expect(L.width).toBeGreaterThan(L.x1);
    expect(L.height).toBe(GEO.top + GEO.gap + GEO.bottom);
  });

  it("stacks parallel gates in the same column", () => {
    const [grover] = circuits("09_grover");
    const L = layout(grover);
    const firstH = L.items.slice(0, 3);
    expect(firstH.map((it) => it.col)).toEqual([0, 0, 0]);
  });

  it("draws one box per sub-function call, in order, never overlapping", () => {
    const [grover] = circuits("09_grover");
    const L = layout(grover);
    expect(L.groups.map((g) => g.name)).toEqual(["oracle", "diffusion", "oracle", "diffusion"]);
    for (let i = 1; i < L.groups.length; i++) expect(L.groups[i].c0).toBeGreaterThan(L.groups[i - 1].c1);
    expect(L.groups.every((g) => g.lo === 0 && g.hi === 2)).toBe(true);
  });

  it("gives every tab of a multi-call circuit its own layout", () => {
    const tabs = circuits("04_ry_angles");
    expect(tabs.map((c) => c.label)).toEqual(["circuit(0)", "circuit(π/4)", "circuit(π/2)", "circuit(π)"]);
    for (const c of tabs) expect(layout(c).items[0].op.params).toHaveLength(1);
  });

  it("widens boxes for long labels and parameters", () => {
    const [challenge] = circuits("08_challenge");
    const ry = challenge.ops[0];
    expect(ry.params).toEqual(["2π/3"]);
    expect(widthOf(ry, approxMeasure)).toBeGreaterThanOrEqual(GEO.gw);
    const wide = { ...ry, params: ["0.123, 0.456, 0.789"] };
    expect(widthOf(wide, approxMeasure)).toBeGreaterThan(widthOf(ry, approxMeasure));
    const gallery = circuits("11_gallery")[0];
    const swap = gallery.ops.find((o) => o.shape === "swap")!;
    expect(widthOf(swap, approxMeasure)).toBe(34);
  });

  it("handles every fixture without throwing", () => {
    for (const [name, f] of Object.entries(FIXTURES)) {
      if (!f.response.ok) continue;
      for (const c of f.response.circuits) {
        const L = layout(c);
        expect(L.items.length, name).toBe(c.ops.length + c.meas.length);
        expect(Number.isFinite(L.width) && Number.isFinite(L.height), name).toBe(true);
      }
    }
  });

  it("uses the injected text measure", () => {
    const [bell] = circuits("00_default");
    const wideFont = layout(bell, (s) => s.length * 30);
    expect(wideFont.width).toBeGreaterThan(layout(bell).width);
  });

  it("has stable keys and signatures", () => {
    const [bell] = circuits("00_default");
    const a = layout(bell).items.map(itemKey);
    expect(new Set(a).size).toBe(a.length);
    expect(circuitSig(bell)).toBe(circuitSig(structuredClone(bell)));
    expect(gateCount(bell)).toBe(2);
  });
});

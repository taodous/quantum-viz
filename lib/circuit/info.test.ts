import { describe, expect, it } from "vitest";

import { FIXTURES } from "./fixtures";
import { tipFor } from "./info";
import type { Circuit } from "./types";

const gallery = (FIXTURES["11_gallery"].response as { circuits: Circuit[] }).circuits[0];
const bell = (FIXTURES["00_default"].response as { circuits: Circuit[] }).circuits[0];

describe("tipFor", () => {
  it("names the gate, shows its call and its matrix", () => {
    const tip = tipFor(bell.ops[0]);
    expect(tip.title).toBe("Hadamard");
    expect(tip.signature).toBe("qml.Hadamard(wires=0)");
    expect(tip.description).toMatch(/superposition/);
    expect(tip.pre).toBe("1/√2");
    expect(tip.matrix).toEqual([["1", "1"], ["1", "−1"]]);
  });

  it("describes CNOT with both wires", () => {
    expect(tipFor(bell.ops[1]).signature).toBe("qml.CNOT(wires=[0, 1])");
  });

  it("marks adjoint and controlled gates and hides the plain matrix", () => {
    const tdag = gallery.ops.find((o) => o.label === "T†")!;
    expect(tipFor(tdag).title).toBe("Porte T · adjointe");
    expect(tipFor(tdag).matrix).toBeUndefined();
    const ch = gallery.ops.find((o) => o.name === "Hadamard" && o.controls.length)!;
    expect(tipFor(ch).title).toBe("Hadamard · contrôlée");
  });

  it("quotes string wire names and shows parameters", () => {
    const rx = gallery.ops.find((o) => o.name === "RX")!;
    expect(tipFor(rx).signature).toBe('qml.RX(0.3, wires="a")');
  });

  it("shows the observable of a measurement", () => {
    const expval = gallery.meas[0];
    expect(tipFor(expval).signature).toBe("qml.expval(qml.Z @ Z)");
    expect(tipFor(bell.meas[0]).signature).toBe("qml.counts()");
  });
});

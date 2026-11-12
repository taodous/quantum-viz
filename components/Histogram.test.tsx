import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURES } from "@/lib/circuit/fixtures";
import type { Circuit } from "@/lib/circuit/types";

import { Histogram } from "./Histogram";

const circuits = (name: string) => (FIXTURES[name].response as { circuits: Circuit[] }).circuits;
const bars = (c: HTMLElement) => [...c.querySelectorAll(".h-bars li")].map((li) => li.getAttribute("aria-label")!.replace(/ /g, " "));
const classes = (c: HTMLElement) => [...c.querySelectorAll(".h-bars li")].map((li) => li.getAttribute("class") ?? "");

afterEach(cleanup);

describe("Histogram", () => {
  it("1 qubit, no gate: 100 % |0⟩, and |1⟩ is shown at 0 %", () => {
    const { container } = render(<Histogram circuit={circuits("01_zero")[0]} />);
    expect(bars(container)).toEqual(["|0⟩ : 100 %", "|1⟩ : 0 %"]);
    expect(classes(container)).toEqual(["", "zero"]);
  });

  it("PauliX: 100 % |1⟩", () => {
    const { container } = render(<Histogram circuit={circuits("02_pauli_x")[0]} />);
    expect(bars(container)).toEqual(["|0⟩ : 0 %", "|1⟩ : 100 %"]);
    expect(container.querySelector("figcaption")?.textContent).toBe("probabilités");
  });

  it("Bell: never |01⟩ nor |10⟩, and it shows; follows the selected tab", () => {
    const [bell, other] = circuits("07_bell");
    const { container, rerender } = render(<Histogram circuit={bell} />);
    expect(container.querySelector("figcaption")?.textContent).toBe("résultats sur 1000 mesures");
    expect([...container.querySelectorAll(".h-ket")].map((k) => k.textContent)).toEqual(["|00⟩", "|01⟩", "|10⟩", "|11⟩"]);
    expect(classes(container)).toEqual(["", "zero", "zero", ""]);
    rerender(<Histogram circuit={other} />);
    expect(classes(container)).toEqual(["zero", "", "", "zero"]);
  });

  it("RY angles: one histogram per call", () => {
    const tabs = circuits("04_ry_angles");
    const p1 = tabs.map((c) => c.histogram!.find((b) => b.state === "1")!.value);
    expect(p1.map((v) => Math.round(v * 1000) / 1000)).toEqual([0, 0.146, 0.5, 1]);
    const { container } = render(<Histogram circuit={tabs[1]} />);
    expect(bars(container)).toEqual(["|0⟩ : 85,4 %", "|1⟩ : 14,6 %"]);
  });

  it("bar height is the share, on an absolute scale", () => {
    const { container } = render(<Histogram circuit={circuits("03_hadamard")[0]} />);
    const vs = [...container.querySelectorAll<HTMLElement>(".h-track")].map((t) => Number(t.style.getPropertyValue("--v")));
    expect(vs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(vs.every((v) => v > 0.4 && v < 0.6)).toBe(true);
  });

  it("Grover on 3 qubits: 8 bars", () => {
    const { container } = render(<Histogram circuit={circuits("09_grover")[0]} />);
    expect(container.querySelectorAll("li")).toHaveLength(8);
  });

  it("expval only: theoretical probabilities, labelled as such", () => {
    const c: Circuit = { ...circuits("02_pauli_x")[0], histogramKind: "theory" };
    const { container } = render(<Histogram circuit={c} />);
    expect(container.querySelector("figcaption")?.textContent).toBe("probabilités théoriques");
  });

  it("many qubits: compact, kets in the tooltip only", () => {
    const histogram = Array.from({ length: 32 }, (_, i) => ({ state: i.toString(2).padStart(5, "0"), value: i === 0 ? 0.9 : 0.1 / 31 }));
    const { container } = render(<Histogram circuit={{ ...circuits("01_zero")[0], histogram }} />);
    expect(container.querySelector(".histo.compact")).not.toBeNull();
    expect(container.querySelectorAll(".h-ket")).toHaveLength(0);
    expect(container.querySelectorAll(".h-pct")).toHaveLength(1);
    expect(container.querySelectorAll("li[title]")).toHaveLength(32);
  });

  it("nothing to show: nothing drawn", () => {
    const { container } = render(<Histogram circuit={{ ...circuits("01_zero")[0], histogram: null }} />);
    expect(container.innerHTML).toBe("");
  });
});

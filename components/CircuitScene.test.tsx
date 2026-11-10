import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FIXTURES } from "@/lib/circuit/fixtures";
import { approxMeasure } from "@/lib/circuit/layout";
import type { Circuit } from "@/lib/circuit/types";

import { CircuitScene } from "./CircuitScene";

const first = (name: string) => (FIXTURES[name].response as { circuits: Circuit[] }).circuits[0];

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const scene = (circuit: Circuit | null, extra: Partial<Parameters<typeof CircuitScene>[0]> = {}) => (
  <CircuitScene circuit={circuit} tabKey="t" measure={approxMeasure} caretLine={0} {...extra} />
);

describe("CircuitScene", () => {
  it("draws wires with |0⟩, gates and the measurement", () => {
    const { container } = render(scene(first("00_default")));
    expect(container.querySelectorAll(".wire")).toHaveLength(2);
    expect([...container.querySelectorAll(".w-ket")].map((t) => t.textContent)).toEqual(["|0⟩", "|0⟩"]);
    const gates = [...container.querySelectorAll(".gate")];
    expect(gates.map((g) => g.getAttribute("class"))).toEqual([
      "gate fam-h enter",
      "gate fam-pauli enter",
      "gate fam-meas enter",
    ]);
    expect(container.querySelectorAll(".w-c")).toHaveLength(2); // classical double line after the meter
  });

  it("animates only the gates that are new", () => {
    const bell = first("00_default");
    const withX = { ...bell, ops: [...bell.ops, { ...bell.ops[0], name: "PauliX", label: "X", family: "pauli" as const, targets: ["#1"], line: 11 }] };
    const { container, rerender } = render(scene(bell));
    rerender(scene(withX));
    const entering = [...container.querySelectorAll(".gate.enter")];
    expect(entering).toHaveLength(2); // the new X, and the meter which moved to a new column
    expect(entering[0].querySelector(".lbl")?.textContent).toBe("X");
    expect(container.querySelectorAll(".wire.enter")).toHaveLength(0);
  });

  it("replays the entrance when the tab changes", () => {
    const bell = first("00_default");
    const { container, rerender } = render(scene(bell));
    rerender(scene(bell, { tabKey: "other" }));
    expect(container.querySelectorAll(".gate.enter")).toHaveLength(3);
  });

  it("lights the gates of the caret line", () => {
    const bell = first("00_default");
    const cnotLine = bell.ops[1].line!;
    const { container } = render(scene(bell, { caretLine: cnotLine }));
    const lit = [...container.querySelectorAll(".gate.lit")];
    expect(lit).toHaveLength(1);
    expect(lit[0].getAttribute("data-line")).toBe(String(cnotLine));
  });

  it("hovering a gate shows its tooltip and reports its code line", () => {
    const bell = first("00_default");
    const onHoverLine = vi.fn();
    const { container } = render(scene(bell, { onHoverLine }));
    const h = container.querySelector(".gate")!;
    act(() => {
      fireEvent.pointerEnter(h);
    });
    expect(onHoverLine).toHaveBeenLastCalledWith(bell.ops[0].line);
    const tip = document.querySelector(".tip")!;
    expect(tip.querySelector("h2")?.textContent).toBe("Hadamard");
    act(() => {
      fireEvent.pointerLeave(h);
    });
    expect(onHoverLine).toHaveBeenLastCalledWith(0);
    expect(document.querySelector(".tip")).toBeNull();
  });

  it("draws one named box per sub-function call", () => {
    const { container } = render(scene(first("09_grover")));
    expect([...container.querySelectorAll(".grp text")].map((t) => t.textContent)).toEqual(["oracle", "diffusion", "oracle", "diffusion"]);
  });

  it("draws every gate shape of the gallery", () => {
    const { container } = render(scene(first("11_gallery")));
    expect(container.querySelector(".gate.bar")).not.toBeNull(); // barrier
    expect(container.querySelectorAll(".odot")).toHaveLength(1); // control on |0⟩
    expect([...container.querySelectorAll(".w-name")].map((t) => t.textContent)).toEqual(["a", "b", "c"]);
    expect([...container.querySelectorAll(".cap")].map((t) => t.textContent)).toEqual(["⟨Z⟩", "⟨Z⟩", "probs"]);
  });

  it("shows the hint when there is nothing to draw", () => {
    const { container } = render(scene(null, { emptyText: "Appelle ton circuit" }));
    expect(container.querySelector(".empty")?.textContent).toBe("Appelle ton circuit");
  });

  it("greys the last valid circuit when stale", () => {
    const { container } = render(scene(first("00_default"), { stale: true }));
    expect(container.querySelector(".view")?.classList.contains("stale")).toBe(true);
  });
});

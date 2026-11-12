import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SafeRender } from "./SafeRender";

type V = { label: string; boom?: boolean };

function Drawing({ v, stale }: { v: V; stale: boolean }) {
  if (v.boom) throw new Error(`cannot draw ${v.label}`);
  return <p className={stale ? "stale" : "fresh"}>{v.label}</p>;
}

const ui = (value: V) => (
  <SafeRender value={value} render={(v, stale) => <Drawing v={v} stale={stale} />} failure={(e) => <strong>{e.message}</strong>} />
);

beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SafeRender", () => {
  it("draws the value", () => {
    const { container } = render(ui({ label: "a" }));
    expect(container.innerHTML).toBe('<p class="fresh">a</p>');
  });

  it("a failing value: the last good drawing stays, greyed, with the message", () => {
    const { container, rerender } = render(ui({ label: "a" }));
    rerender(ui({ label: "b", boom: true }));
    expect(container.querySelector("p")?.outerHTML).toBe('<p class="stale">a</p>');
    expect(container.querySelector("strong")?.textContent).toBe("cannot draw b");
  });

  it("the next value is drawn normally again", () => {
    const { container, rerender } = render(ui({ label: "a" }));
    rerender(ui({ label: "b", boom: true }));
    rerender(ui({ label: "c" }));
    expect(container.innerHTML).toBe('<p class="fresh">c</p>');
  });

  it("failing from the start: only the message", () => {
    const { container } = render(ui({ label: "a", boom: true }));
    expect(container.innerHTML).toBe("<strong>cannot draw a</strong>");
  });

  it("re-rendering the same failing value does not loop", () => {
    const bad = { label: "b", boom: true };
    const { container, rerender } = render(ui({ label: "a" }));
    rerender(ui(bad));
    rerender(ui(bad));
    expect(container.querySelector("strong")?.textContent).toBe("cannot draw b");
  });
});

import { describe, expect, it } from "vitest";

import { fmtNum, pretty } from "./fmt";

// Same cases as runner/tests/test_fmt.py: the two implementations must agree.
describe("fmtNum", () => {
  it.each([
    [0, "0"],
    [3, "3"],
    [-2, "−2"],
    [Math.PI, "π"],
    [-Math.PI, "−π"],
    [Math.PI / 4, "π/4"],
    [(2 * Math.PI) / 3, "2π/3"],
    [2 * Math.acos(Math.sqrt(0.25)), "2π/3"],
    [(3 * Math.PI) / 2, "3π/2"],
    [Math.PI / 32, "π/32"],
    [0.5, "0.5"],
    [0.123456, "0.123"],
    [-0.25, "−0.25"],
    [123.456, "123.5"],
    [Infinity, "∞"],
    [-Infinity, "−∞"],
    [NaN, "?"],
  ])("%s → %s", (v, expected) => {
    expect(fmtNum(v)).toBe(expected);
  });
});

describe("pretty", () => {
  it("turns parameter names into symbols", () => {
    expect(pretty("theta")).toBe("θ");
    expect(pretty("phi_1")).toBe("φ₁");
    expect(pretty("angle")).toBe("angle");
  });
});

/**
 * Circuit layout, ported from the prototype (`widthOf`, `layout`). Pure:
 * text widths come from an injected `measure` function, so it runs in tests
 * and on the server with an approximation, then in the browser with canvas.
 */

import type { Circuit, Meas, Op } from "./types";

export const GEO = { gap: 66, gh: 40, gw: 40, cg: 18, top: 48, bottom: 36 } as const;

export type FontKind = "label" | "param" | "cap" | "wire";
export type Measure = (text: string, font: FontKind) => number;

export type AnyOp = Op | Meas;

export type Item = {
  op: AnyOp;
  /** index in the circuit: ops first, then measurements */
  index: number;
  col: number;
  lo: number;
  hi: number;
  w: number;
  /** wire indices of controls / targets */
  ci: number[];
  ti: number[];
};

export type GroupBox = { id: number; name: string; c0: number; c1: number; lo: number; hi: number };

export type Layout = {
  n: number;
  items: Item[];
  colX: number[];
  colL: number[];
  colW: number[];
  x0: number;
  x1: number;
  measX: (number | null)[];
  groups: GroupBox[];
  depth: number;
  width: number;
  height: number;
};

export const wireY = (i: number) => GEO.top + i * GEO.gap;

/** Average glyph widths of the prototype fonts at their sizes, for SSR/tests. */
const APPROX: Record<FontKind, number> = { label: 9.2, param: 6.3, cap: 5.4, wire: 6.6 };
export const approxMeasure: Measure = (text, font) => [...text].length * APPROX[font];

export function isMeas(op: AnyOp): op is Meas {
  return (op as Meas).terminal === true;
}

export function widthOf(op: AnyOp, measure: Measure): number {
  if (op.shape === "barrier") return 8;
  if (op.shape === "oplus" || op.shape === "dot" || op.shape === "swap") return 34;
  if (op.shape === "meter") {
    const caps = isMeas(op) ? Object.values(op.caps) : [op.caption ?? ""];
    return Math.max(GEO.gw, ...caps.map((c) => measure(c, "cap") + 12));
  }
  const pw = op.params.length ? measure(op.params.join(", "), "param") + 16 : 0;
  return Math.ceil(Math.max(GEO.gw, measure(op.label, "label") + 20, pw));
}

export function layout(c: Circuit, measure: Measure = approxMeasure): Layout {
  const n = c.wires.length;
  const idx = new Map(c.wires.map((w, i) => [w.key, i]));
  const front = new Array<number>(n).fill(0);
  const colW: number[] = [];
  const items: Item[] = [];
  const sync = () => {
    const m = n ? Math.max(...front) : 0;
    front.fill(m);
    return m;
  };
  const wireIndex = (k: string) => {
    const i = idx.get(k);
    if (i === undefined) throw new Error(`unknown wire ${k}`);
    return i;
  };
  const place = (op: AnyOp, index: number) => {
    const ws = [...op.controls, ...op.targets].map(wireIndex);
    if (!ws.length) return;
    const lo = Math.min(...ws);
    const hi = Math.max(...ws);
    let col = 0;
    for (let i = lo; i <= hi; i++) col = Math.max(col, front[i]);
    for (let i = lo; i <= hi; i++) front[i] = col + 1;
    const w = widthOf(op, measure);
    colW[col] = Math.max(colW[col] ?? 0, w);
    items.push({ op, index, col, lo, hi, w, ci: op.controls.map(wireIndex), ti: op.targets.map(wireIndex) });
  };

  // A sub-function's gates start a fresh column block, so its box never overlaps.
  let cur: number | null = null;
  c.ops.forEach((op, i) => {
    const g = op.group ? op.group.id : null;
    if (g !== cur) {
      sync();
      cur = g;
    }
    place(op, i);
  });
  const depth = sync();
  c.meas.forEach((m, i) => place(m, c.ops.length + i));

  const x0 = Math.ceil(Math.max(70, Math.max(0, ...c.wires.map((w) => measure(w.label, "wire"))) + 56));
  const colX: number[] = [];
  const colL: number[] = [];
  let x = x0 + 20;
  colW.forEach((w, i) => {
    colL[i] = x;
    colX[i] = x + w / 2;
    x += w + GEO.cg;
  });
  const x1 = colW.length ? x - GEO.cg + 26 : x0 + 150;

  // Where each wire becomes classical (after its final measurement).
  const measX: (number | null)[] = new Array(n).fill(null);
  for (const it of items) {
    if (isMeas(it.op) && it.op.shape === "meter") for (const i of it.ti) if (measX[i] === null) measX[i] = colX[it.col];
  }

  const groups = new Map<number, GroupBox>();
  for (const it of items) {
    const g = it.op.group;
    if (!g) continue;
    const r = groups.get(g.id) ?? { id: g.id, name: g.name, c0: it.col, c1: it.col, lo: it.lo, hi: it.hi };
    r.c0 = Math.min(r.c0, it.col);
    r.c1 = Math.max(r.c1, it.col);
    r.lo = Math.min(r.lo, it.lo);
    r.hi = Math.max(r.hi, it.hi);
    groups.set(g.id, r);
  }

  return {
    n, items, colX, colL, colW, x0, x1, measX, groups: [...groups.values()], depth,
    width: x1 + 14,
    height: GEO.top + Math.max(0, n - 1) * GEO.gap + GEO.bottom,
  };
}

/** Identity of a drawn gate across re-renders: only new ones animate in. */
export function itemKey(it: Item): string {
  const op = it.op;
  return [op.name, op.label, op.params.join(), op.controls.join(), op.targets.join(), it.col].join("|");
}

/** Signature of a circuit's drawing, to skip redraws when nothing changed. */
export function circuitSig(c: Circuit): string {
  return JSON.stringify([
    c.label, c.wires, c.shots,
    c.ops.map((o) => [o.name, o.label, o.params, o.controls, o.controlValues, o.targets, o.group?.id, o.line, o.cond]),
    c.meas.map((m) => [m.name, m.targets, m.caps, m.line]),
  ]);
}

/** Gates counted in the stats bar (not barriers nor mid-circuit measurements). */
export function gateCount(c: Circuit): number {
  return c.ops.filter((o) => o.shape !== "barrier" && o.name !== "measure").length;
}

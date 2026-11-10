"use client";

import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { tipFor } from "@/lib/circuit/info";
import { GEO, type Item, type Layout, type Measure, circuitSig, isMeas, itemKey, layout, wireY as y } from "@/lib/circuit/layout";
import type { Circuit } from "@/lib/circuit/types";

import { GateTip } from "./GateTip";

type Props = {
  circuit: Circuit | null;
  /** identity of the selected tab: switching tabs replays the entrance */
  tabKey: string;
  measure: Measure;
  /** editor line holding the caret (0: none): its gates light up */
  caretLine: number;
  /** a gate is hovered or focused: highlight its line in the editor (0: none) */
  onHoverLine?: (line: number) => void;
  stale?: boolean;
  emptyText?: string;
};

type Anim = { sig: string | null; tabKey: string; keys: Set<string>; wires: Set<string>; enterKeys: Set<string>; enterWires: Set<string> };

const css = (vars: Record<string, string>) => vars as CSSProperties;

/** The circuit drawing (SVG), ported from the prototype's draw()/drawItem(). */
export function CircuitScene({ circuit, tabKey, measure, caretLine, onHoverLine, stale, emptyText }: Props) {
  const L = useMemo(() => (circuit && circuit.wires.length ? layout(circuit, measure) : null), [circuit, measure]);
  const keys = useMemo(() => (L ? L.items.map(itemKey) : []), [L]);
  const sig = circuit && L ? circuitSig(circuit) : null;

  // Only gates (and wires) that were not in the previous drawing animate in.
  const [anim, setAnim] = useState<Anim>({ sig: null, tabKey, keys: new Set(), wires: new Set(), enterKeys: new Set(), enterWires: new Set() });
  if (sig !== anim.sig || tabKey !== anim.tabKey) {
    const fresh = tabKey !== anim.tabKey;
    const prevKeys = fresh ? new Set<string>() : anim.keys;
    const prevWires = fresh ? new Set<string>() : anim.wires;
    const wires = circuit ? circuit.wires.map((w) => w.key) : [];
    setAnim({
      sig, tabKey, keys: new Set(keys), wires: new Set(wires),
      enterKeys: new Set(keys.filter((k) => !prevKeys.has(k))),
      enterWires: new Set(wires.filter((k) => !prevWires.has(k))),
    });
  }

  // Fit the drawing to the panel (between 0.6× and 1.75×).
  const viewRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 36, h: el.clientHeight - 36 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const k = L && box ? Math.max(0.6, Math.min(1.75, box.w / L.width, box.h / L.height)) : 1;

  const [hover, setHover] = useState<{ index: number; rect: DOMRect } | null>(null);
  const showTip = (it: Item, el: Element) => {
    setHover({ index: it.index, rect: el.getBoundingClientRect() });
    onHoverLine?.(it.op.line ?? 0);
  };
  const hideTip = () => {
    setHover(null);
    onHoverLine?.(0);
  };
  const hovered = hover && L ? L.items.find((it) => it.index === hover.index) : undefined;

  return (
    <div ref={viewRef} className={`view${stale ? " stale" : ""}`} onScroll={hideTip}>
      {L && circuit ? (
        <svg
          viewBox={`0 0 ${L.width} ${L.height}`}
          width={Math.round(L.width * k)}
          height={Math.round(L.height * k)}
          role="img"
          aria-label={`Circuit ${circuit.label}`}
        >
          <defs>
            <linearGradient id="comet" x1="0" x2="1">
              <stop offset="0" stopColor="#86d6ff" stopOpacity="0" />
              <stop offset="1" stopColor="#e3f4ff" stopOpacity="1" />
            </linearGradient>
          </defs>
          {L.groups.map((g) => {
            const x = L.colL[g.c0] - 8;
            const w = L.colL[g.c1] + L.colW[g.c1] + 8 - x;
            const yy = y(g.lo) - GEO.gh / 2 - 9;
            const h = y(g.hi) - y(g.lo) + GEO.gh + 18;
            return (
              <g className="grp" key={`grp-${g.id}`}>
                <rect x={x} y={yy} width={w} height={h} rx={12} />
                <text x={x + 4} y={yy - 6}>{g.name}</text>
              </g>
            );
          })}
          {circuit.wires.map((w, i) => <WireLine key={w.key} L={L} i={i} label={w.label} enter={anim.enterWires.has(w.key)} />)}
          {L.items.map((it, i) => (
            <Gate
              key={keys[i]}
              it={it}
              L={L}
              enter={anim.enterKeys.has(keys[i])}
              lit={caretLine > 0 && it.op.line === caretLine}
              onShow={showTip}
              onHide={hideTip}
            />
          ))}
        </svg>
      ) : (
        <div className="empty">
          {emptyText ?? (
            <>
              Aucun qubit pour l&apos;instant.
              <br />
              Ajoute une porte, par exemple qml.Hadamard(wires=0)
            </>
          )}
        </div>
      )}
      {hovered && hover && <GateTip content={tipFor(hovered.op)} anchor={hover.rect} />}
    </div>
  );
}

function WireLine({ L, i, label, enter }: { L: Layout; i: number; label: string; enter: boolean }) {
  const wy = y(i);
  const xs = L.x0;
  const mx = L.measX[i];
  const xe = mx === null ? L.x1 : mx;
  const span = xe - xs;
  return (
    <>
      <g className={`wire${enter ? " enter" : ""}`}>
        <text className="w-name" x={L.x0 - 38} y={wy} textAnchor="end" dominantBaseline="central">{label}</text>
        <text className="w-ket" x={L.x0 - 8} y={wy + 0.5} textAnchor="end" dominantBaseline="central">|0⟩</text>
        <line className="w-q" pathLength={1} x1={xs} y1={wy} x2={xe} y2={wy} />
        {mx !== null && <path className="w-c" d={`M${mx} ${wy - 1.6}H${L.x1}M${mx} ${wy + 1.6}H${L.x1}`} />}
      </g>
      {span > 60 && (
        <rect
          className="comet"
          x={-30}
          y={wy - 0.8}
          width={30}
          height={1.6}
          rx={0.8}
          fill="url(#comet)"
          style={css({ "--a": `${xs}px`, "--b": `${xe + 4}px`, "--t": `${(5.5 + span / 90).toFixed(2)}s`, "--dl": `${(0.9 + i * 0.85).toFixed(2)}s` })}
        />
      )}
    </>
  );
}

type GateProps = { it: Item; L: Layout; enter: boolean; lit: boolean; onShow: (it: Item, el: Element) => void; onHide: () => void };

function Gate({ it, L, enter, lit, onShow, onHide }: GateProps) {
  const op = it.op;
  const cx = L.colX[it.col];
  const H = GEO.gh;
  const all = [...it.ci, ...it.ti];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const yTop = y(lo) - H / 2 - 4;
  const hh = y(hi) - y(lo) + H + 8;

  const line = (a: number, b: number, k = "stem") => <line key={k} className="ln" x1={cx} y1={a} x2={cx} y2={b} />;
  const dots = () =>
    it.ci.map((w, k) => {
      const open = op.controlValues[k] === 0;
      return <circle key={`c${k}`} className={open ? "odot" : "dot"} cx={cx} cy={y(w)} r={open ? 4.6 : 4.3} />;
    });
  const box = (x: number, yy: number, w: number, h: number, k = "box") => [
    <rect key={`${k}-b`} className="b" x={x} y={yy} width={w} height={h} rx={9} />,
    <rect key={`${k}-t`} className="tint" x={x} y={yy} width={w} height={h} rx={9} />,
  ];

  let parts: ReactNode;
  if (op.shape === "barrier") {
    parts = line(y(lo) - H / 2 - 6, y(hi) + H / 2 + 6);
  } else if (op.shape === "oplus") {
    const t = y(it.ti[0]);
    parts = [
      line(y(lo), y(hi)),
      dots(),
      <circle key="o-b" className="b" cx={cx} cy={t} r={11.5} />,
      <circle key="o-t" className="tint" cx={cx} cy={t} r={11.5} />,
      <path key="o-p" className="ln" d={`M${cx - 11.5} ${t}H${cx + 11.5}M${cx} ${t - 11.5}V${t + 11.5}`} />,
    ];
  } else if (op.shape === "dot") {
    parts = [line(y(lo), y(hi)), dots(), it.ti.map((w) => <circle key={`t${w}`} className="dot" cx={cx} cy={y(w)} r={4.3} />)];
  } else if (op.shape === "swap") {
    parts = [
      line(y(lo), y(hi)),
      dots(),
      it.ti.map((w) => <path key={`x${w}`} className="ln" d={`M${cx - 6} ${y(w) - 6}l12 12M${cx + 6} ${y(w) - 6}l-12 12`} />),
    ];
  } else if (op.shape === "meter") {
    parts = [
      op.shape === "meter" && isMeas(op) && op.joint ? line(y(lo), y(hi)) : null,
      it.ti.map((w, j) => {
        const wy = y(w);
        const cap = isMeas(op) ? op.caps[op.targets[j]] : (op.caption ?? "");
        return [
          ...box(cx - it.w / 2, wy - H / 2, it.w, H, `m${w}`),
          <path key={`m${w}-p`} className="ln" d={`M${cx - 8.5} ${wy - 1}a8.5 8.5 0 0 1 17 0M${cx} ${wy - 1}l5.5 -8`} />,
          <text key={`m${w}-c`} className="cap" x={cx} y={wy + 11}>{cap}</text>,
        ];
      }),
    ];
  } else {
    const tlo = Math.min(...it.ti);
    const thi = Math.max(...it.ti);
    const by = y(tlo) - H / 2;
    const bh = y(thi) - y(tlo) + H;
    const cy = by + bh / 2;
    parts = [
      it.ci.length ? [line(y(lo), y(hi)), dots()] : null,
      box(cx - it.w / 2, by, it.w, bh),
      op.params.length ? (
        [
          <text key="l" className="lbl" x={cx} y={cy - 6.5}>{op.label}</text>,
          <text key="p" className="prm" x={cx} y={cy + 9.5}>{op.params.join(", ")}</text>,
        ]
      ) : (
        <text key="l" className="lbl" x={cx} y={cy + 0.5}>{op.label}</text>
      ),
    ];
  }

  const cls = ["gate", `fam-${op.family}`, op.shape === "barrier" ? "bar" : "", op.cond ? "cond" : "", enter ? "enter" : "", lit ? "lit" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <g
      className={cls}
      data-line={op.line ?? 0}
      tabIndex={0}
      style={css({ "--d": `${Math.min(it.col, 16) * 55}ms` })}
      onPointerEnter={(e) => onShow(it, e.currentTarget)}
      onPointerLeave={onHide}
      onFocus={(e) => onShow(it, e.currentTarget)}
      onBlur={onHide}
    >
      <rect className="hit" x={cx - it.w / 2 - 4} y={yTop} width={it.w + 8} height={hh} />
      {parts}
    </g>
  );
}

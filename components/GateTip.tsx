"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TipContent } from "@/lib/circuit/info";

/** Gate tooltip: name, one-sentence role, matrix. Placed above the gate, or below if no room. */
export function GateTip({ content, anchor }: { content: TipContent; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tr = el.getBoundingClientRect();
    let x = anchor.left + anchor.width / 2 - tr.width / 2;
    let y = anchor.top - tr.height - 10;
    if (y < 8) y = anchor.bottom + 10;
    x = Math.max(8, Math.min(x, innerWidth - tr.width - 8));
    setPos({ x, y });
  }, [anchor, content]);

  // Portal: the panels use backdrop-filter, which would trap a fixed element.
  return createPortal(
    <div ref={ref} role="tooltip" className={`tip${pos ? " show" : ""}`} style={pos ? { left: pos.x, top: pos.y } : undefined}>
      <h2>{content.title}</h2>
      <code>{content.signature}</code>
      {content.description && <p>{content.description}</p>}
      {content.matrix && (
        <div className="mx">
          {content.pre && <span className="pre">{content.pre}</span>}
          <div className="g" style={{ gridTemplateColumns: `repeat(${content.matrix.length}, auto)` }}>
            {content.matrix.flat().map((x, i) => (
              <span key={i}>{x}</span>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

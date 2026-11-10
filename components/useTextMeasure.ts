"use client";

import { useEffect, useState } from "react";

import { approxMeasure, type FontKind, type Measure } from "@/lib/circuit/layout";

const FONTS: Record<FontKind, [string, "--f-display" | "--f-mono"]> = {
  label: ["600 15px", "--f-display"],
  param: ["500 10.5px", "--f-mono"],
  cap: ["500 9px", "--f-mono"],
  wire: ["500 11px", "--f-mono"],
};

/**
 * Text measurement for the layout. Starts with the approximation (same on
 * server and client, so hydration matches), then switches to real canvas
 * measurements once the web fonts are loaded.
 */
export function useTextMeasure(): Measure {
  const [measure, setMeasure] = useState<Measure>(() => approxMeasure);

  useEffect(() => {
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) return;
      const css = getComputedStyle(document.documentElement);
      const fonts = Object.fromEntries(
        Object.entries(FONTS).map(([k, [w, v]]) => [k, `${w} ${css.getPropertyValue(v).trim() || "sans-serif"}`]),
      ) as Record<FontKind, string>;
      const cache = new Map<string, number>();
      const real: Measure = (text, font) => {
        const key = font + "\u0000" + text;
        let w = cache.get(key);
        if (w === undefined) {
          ctx.font = fonts[font];
          w = ctx.measureText(text).width;
          cache.set(key, w);
        }
        return w;
      };
      setMeasure(() => real);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return measure;
}

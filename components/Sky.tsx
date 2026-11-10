"use client";

import { useEffect, useRef } from "react";

type Star = { x: number; y: number; r: number; a: number; p: number; s: number; warm: boolean };
type Meteor = { t0: number; life: number; x: number; y: number; dx: number; dy: number };

/** Starry canvas background with a rare meteor, ported from the prototype. */
export function Sky() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, last = 0, nextMeteor = 9000, raf = 0;
    let stars: Star[] = [];
    let meteor: Meteor | null = null;

    function paint(t: number) {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);
      for (const s of stars) {
        ctx!.globalAlpha = s.a * (reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(t * 0.001 * s.s + s.p));
        ctx!.fillStyle = s.warm ? "#ffe7c4" : "#cdd9ff";
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, 6.283);
        ctx!.fill();
      }
      if (meteor) {
        const k = (t - meteor.t0) / meteor.life;
        if (k >= 1) meteor = null;
        else {
          const x = meteor.x + meteor.dx * k, y = meteor.y + meteor.dy * k;
          const tx = x - meteor.dx * 0.16, ty = y - meteor.dy * 0.16;
          const g = ctx!.createLinearGradient(tx, ty, x, y);
          g.addColorStop(0, "rgba(205,217,255,0)");
          g.addColorStop(1, "rgba(230,240,255,.8)");
          ctx!.globalAlpha = Math.sin(Math.PI * k) * 0.8;
          ctx!.strokeStyle = g;
          ctx!.lineWidth = 1.1;
          ctx!.beginPath();
          ctx!.moveTo(tx, ty);
          ctx!.lineTo(x, y);
          ctx!.stroke();
        }
      }
      ctx!.globalAlpha = 1;
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv!.clientWidth;
      H = cv!.clientHeight;
      cv!.width = W * dpr;
      cv!.height = H * dpr;
      const n = Math.min(420, Math.round((W * H) / 4600));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H, r: Math.pow(Math.random(), 3) * 1.15 + 0.25,
        a: Math.random() * 0.5 + 0.12, p: Math.random() * 6.283, s: Math.random() * 0.7 + 0.2, warm: Math.random() < 0.14,
      }));
      paint(0);
    }

    function frame(t: number) {
      raf = requestAnimationFrame(frame);
      if (document.hidden || t - last < 40) return;
      const dt = t - last;
      last = t;
      for (const s of stars) {
        s.x -= s.r * 0.0045 * dt * 0.06;
        if (s.x < -2) s.x = W + 2;
      }
      if (!meteor && t > nextMeteor) {
        meteor = { t0: t, life: 950, x: W * (0.25 + Math.random() * 0.7), y: H * Math.random() * 0.4, dx: -(160 + Math.random() * 160), dy: 70 + Math.random() * 70 };
        nextMeteor = t + 16000 + Math.random() * 22000;
      }
      paint(t);
    }

    addEventListener("resize", resize);
    resize();
    if (!reduceMotion) raf = requestAnimationFrame(frame);
    return () => {
      removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className="sky" aria-hidden="true" />;
}

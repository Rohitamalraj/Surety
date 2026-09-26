"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

/**
 * Surety's illustration engine: animated contour / signal line art, stroked in the accent blue.
 * Each scene is a small story from the product:
 *   arrows (enforce) — flow lines hit the hook's barrier and are turned away
 *   signal (record)  — scattered lines converge into a lens: the violation, recomputed
 *   loop   (payout)  — orbit rings, a payout travelling the outer ring
 *   hand   (incident)— a clean signal carrying a malicious burst (drawn in the loss red)
 *   field  (ambient) — slow topographic contours
 */
export type LineShape = "arrows" | "signal" | "loop" | "hand" | "field";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function LineArt({ shape, className }: { shape: LineShape; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const theme = useTheme();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const canvas: HTMLCanvasElement = el;
    const c2d = canvas.getContext("2d");
    if (!c2d) return;
    const ctx: CanvasRenderingContext2D = c2d;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const styles = getComputedStyle(canvas);
    // Theme colours are oklch(); fall back to hex if this canvas can't parse them.
    const pick = (cssVar: string, fallback: string) => {
      const v = styles.getPropertyValue(cssVar).trim();
      if (!v) return fallback;
      ctx.strokeStyle = fallback;
      ctx.strokeStyle = v;
      return ctx.strokeStyle === fallback.toLowerCase() ? fallback : v;
    };
    const blue = pick("--signal", "#2f6bff");
    const red = pick("--loss", "#d64545");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function resize() {
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function line(points: [number, number][], alpha: number, width = 1.2, color = blue) {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width * dpr;
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }

    function draw(t: number) {
      resize();
      const w = canvas.width;
      const h = canvas.height;
      const step = 5 * dpr;
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (shape === "field") {
        const n = Math.max(8, Math.round(h / (14 * dpr)));
        for (let i = 0; i < n; i++) {
          const base = (h * (i + 0.5)) / n;
          const pts: [number, number][] = [];
          for (let x = 0; x <= w; x += step) {
            const y =
              base +
              9 * dpr * Math.sin(x * 0.006 / dpr + t * 0.5 + i * 0.55) +
              5 * dpr * Math.sin(x * 0.017 / dpr - t * 0.35 + i * 1.3);
            pts.push([x, y]);
          }
          line(pts, 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(i * 0.9 + t * 0.4)));
        }
      } else if (shape === "arrows") {
        // flow lines deflected around a barrier (the hook)
        const bx = w * 0.64;
        const mid = h / 2;
        const n = 11;
        ctx.setLineDash([10 * dpr, 7 * dpr]);
        ctx.lineDashOffset = -t * 40 * dpr;
        for (let i = 0; i < n; i++) {
          const y0 = (h * (i + 0.5)) / n;
          const side = y0 < mid ? -1 : 1;
          const closeness = 1 - Math.abs(y0 - mid) / (h / 2);
          const pts: [number, number][] = [];
          for (let x = 0; x <= bx - 6 * dpr; x += step) {
            const push = side * closeness * h * 0.22 * smooth(bx * 0.45, bx, x);
            pts.push([x, y0 + push + 2 * dpr * Math.sin(x * 0.02 / dpr + t * 2 + i)]);
          }
          line(pts, 0.35 + 0.5 * closeness);
        }
        ctx.setLineDash([]);
        // the barrier
        line([[bx, h * 0.14], [bx, h * 0.86]], 1, 3);
        line([[bx + 7 * dpr, h * 0.22], [bx + 7 * dpr, h * 0.78]], 0.35, 1.5);
        // what gets through the rules continues calmly on the right
        for (let i = 0; i < 3; i++) {
          const y0 = mid + (i - 1) * h * 0.09;
          const pts: [number, number][] = [];
          for (let x = bx + 16 * dpr; x <= w; x += step) pts.push([x, y0 + 2 * dpr * Math.sin(x * 0.03 / dpr - t * 2)]);
          line(pts, 0.55);
        }
      } else if (shape === "signal") {
        // scattered lines converge into a lens: the violation, recomputed from public data
        const cx = w * 0.74;
        const cy = h / 2;
        const n = 13;
        for (let i = 0; i < n; i++) {
          const y0 = (h * (i + 0.5)) / n;
          const pts: [number, number][] = [];
          for (let x = 0; x <= cx; x += step) {
            const k = smooth(0, cx, x);
            const jitter = (1 - k) * 10 * dpr * Math.sin(x * 0.05 / dpr + t * 1.6 + i * 2.1);
            pts.push([x, y0 + (cy - y0) * k * k + jitter]);
          }
          line(pts, 0.3 + 0.4 * (i % 3 === 0 ? 1 : 0.5));
        }
        const r = h * (0.17 + 0.015 * Math.sin(t * 2));
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.9 - k * 0.28;
          ctx.strokeStyle = blue;
          ctx.lineWidth = (2 - k * 0.5) * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, r + k * 9 * dpr, 0, Math.PI * 2);
          ctx.stroke();
        }
        line([[cx + r + 30 * dpr, cy], [w, cy]], 0.8, 2);
      } else if (shape === "loop") {
        // orbit rings; a payout travels the outer ring
        const cx = w / 2;
        const cy = h / 2;
        const R = Math.min(w, h) * 0.4;
        for (let k = 1; k <= 4; k++) {
          const r = (R * k) / 4;
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = blue;
          ctx.lineWidth = 1 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          const a = t * (0.5 + k * 0.25) * (k % 2 ? 1 : -1);
          ctx.globalAlpha = 0.9;
          ctx.lineWidth = 2.2 * dpr;
          ctx.beginPath();
          ctx.arc(cx, cy, r, a, a + 0.9);
          ctx.stroke();
        }
        const a = t * 1.1;
        ctx.globalAlpha = 1;
        ctx.fillStyle = blue;
        ctx.beginPath();
        ctx.arc(cx + R * Math.cos(a), cy + R * Math.sin(a), 5 * dpr, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "hand") {
        // a clean carrier signal; a malicious burst rides through it
        const mid = h / 2;
        const burstX = ((t * 0.12) % 1.3) * w - 0.15 * w;
        for (let k = -2; k <= 2; k++) {
          const pts: [number, number][] = [];
          const burst: [number, number][] = [];
          for (let x = 0; x <= w; x += step * 0.6) {
            const env = Math.exp(-(((x - burstX) / (w * 0.07)) ** 2));
            const y =
              mid +
              k * h * 0.13 +
              4 * dpr * Math.sin(x * 0.04 / dpr + t * 3 + k) +
              env * h * 0.2 * Math.sin(x * 0.35 / dpr + t * 8) * (k === 0 ? 1 : 0.35);
            pts.push([x, y]);
            if (k === 0 && env > 0.08) burst.push([x, y]);
          }
          line(pts, k === 0 ? 0.85 : 0.3, k === 0 ? 1.8 : 1);
          if (burst.length > 1) line(burst, 1, 2.2, red);
        }
      }
      ctx.globalAlpha = 1;
    }

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      draw((now - start) / 1000);
      raf = requestAnimationFrame(frame);
    };
    draw(0);
    if (!reduce) raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [shape, theme]);

  return (
    <div className={className} aria-hidden="true">
      <canvas ref={ref} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}

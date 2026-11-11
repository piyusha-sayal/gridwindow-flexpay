"use client";

import { useEffect, useRef } from "react";

/**
 * Decorative page backdrop: slowly drifting points joined by hairlines, which also reach toward the pointer.
 * Purely visual (aria-hidden). Draws one static frame under prefers-reduced-motion and pauses when the tab is hidden.
 */
export default function AmbientBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const gold = "182,130,53";
    let w = 1;
    let h = 1;
    let raf = 0;
    let mx = -1e4;
    let my = -1e4;
    type P = { x: number; y: number; vx: number; vy: number; r: number };
    let pts: P[] = [];

    const seed = () => {
      const n = Math.round(Math.min(90, (w * h) / 14000));
      pts = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.2 + 0.7,
      }));
    };
    const resize = () => {
      const d = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(1, window.innerWidth);
      h = Math.max(1, window.innerHeight);
      canvas.width = w * d;
      canvas.height = h * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      seed();
      if (reduced) draw();
    };
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
        }
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        if (!a) continue;
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j];
          if (!b) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 150) {
            ctx.strokeStyle = `rgba(${gold},${(1 - d / 150) * 0.22})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
        const dm = Math.hypot(a.x - mx, a.y - my);
        if (dm < 190) {
          ctx.strokeStyle = `rgba(${gold},${(1 - dm / 190) * 0.4})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(mx, my);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${gold},0.55)`;
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const loop = () => {
      if (!document.hidden) draw();
      raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    if (!reduced) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <canvas ref={ref} className="ambient-bg" aria-hidden="true" />;
}

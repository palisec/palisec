"use client";

import { useEffect, useRef } from "react";

/**
 * The data orb: points on a sphere turning slowly in the water. Near points are pale aqua,
 * far points sink into deep teal, and the rim catches lavender, so it reads as bioluminescent
 * rather than lit. One canvas, no library. It stops drawing when off-screen or in a hidden tab,
 * and renders a single still frame when the visitor prefers reduced motion.
 */

const COUNT = 1100;

// Fibonacci sphere: evenly spread, deterministic, no clumping at the poles.
const POINTS = Array.from({ length: COUNT }, (_, i) => {
  const y = 1 - (i / (COUNT - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const t = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(t) * r, y, Math.sin(t) * r] as const;
});

export function ParticleSphere({ className = "", speed = 0.00012 }: { className?: string; speed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    let size = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      size = Math.min(r.width, r.height);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      if (still) draw(0);
    };

    const draw = (time: number) => {
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const R = size * 0.46;
      const a = time * speed;
      const tilt = 0.38;
      const cosA = Math.cos(a), sinA = Math.sin(a), cosT = Math.cos(tilt), sinT = Math.sin(tilt);
      for (const [x, y, z] of POINTS) {
        // Turn around Y, then tilt toward the viewer.
        const x1 = x * cosA + z * sinA;
        const z1 = -x * sinA + z * cosA;
        const y2 = y * cosT - z1 * sinT;
        const z2 = y * sinT + z1 * cosT;
        const depth = (z2 + 1) / 2; // 0 far, 1 near
        const rim = 1 - Math.abs(z2); // brightest at the silhouette
        const px = w / 2 + x1 * R;
        const py = h / 2 + y2 * R;
        const s = 0.8 + depth * 1.6;
        let color: string;
        if (rim > 0.86) color = `rgba(250, 209, 255, ${0.25 + rim * 0.45})`;
        else if (depth > 0.55) color = `rgba(203, 255, 252, ${0.18 + depth * 0.62})`;
        else color = `rgba(0, 130, 124, ${0.12 + depth * 0.5})`;
        ctx.fillStyle = color;
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
    };

    const loop = (t: number) => {
      if (visible && !document.hidden) draw(t);
      raf = requestAnimationFrame(loop);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)));
    io.observe(canvas);
    resize();
    if (!still) raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [speed]);

  return <canvas ref={ref} aria-hidden className={className} />;
}

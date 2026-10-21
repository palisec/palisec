"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Cube } from "./cube";

/**
 * Hero composition: the citrine cube above the headline, inside two counter-rotating
 * orbit rings carrying check nodes, over a field of twinkling points. Pointer movement
 * tilts the whole scene slightly. If a generated hero loop exists at /media/hero-cube.mp4
 * it replaces the CSS cube; otherwise the CSS cube is the hero.
 */

const INNER = ["AUTH", "SCHEMA", "REPLAY", "TARGET", "METHOD", "VALUE"];
const OUTER = ["FEE", "PRICE", "BUDGET", "PENDING", "LOOP", "HUMAN", "SIGN", "SUBMIT"];

// Deterministic star field so server and client render identically.
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { x: round(r(1) * 100), y: round(r(2) * 100), s: r(3) > 0.85 ? 2 : 1, d: round(r(4) * 6) };
});

export function HeroScene({ videoSrc }: { videoSrc?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [videoOk, setVideoOk] = useState(Boolean(videoSrc));

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth - 0.5;
        const y = e.clientY / window.innerHeight - 0.5;
        el.style.setProperty("--rx", `${(-y * 8).toFixed(2)}deg`);
        el.style.setProperty("--ry", `${(x * 10).toFixed(2)}deg`);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {STARS.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-bone"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.s}px`,
            height: `${s.s}px`,
            animation: `twinkle ${3 + s.d}s ease-in-out ${s.d}s infinite`,
          }}
        />
      ))}

      <div className="absolute inset-0 origin-center scale-[0.62] opacity-45 sm:scale-[0.85] lg:scale-100">
      <div
        ref={ref}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-transform duration-500 ease-out"
        style={{ transform: "translate(-50%, -50%) perspective(1200px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))" } as CSSProperties}
      >
        <Ring size={560} items={OUTER} seconds={90} reverse dashed />
        <Ring size={380} items={INNER} seconds={60} />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-float">
          {videoSrc && videoOk ? (
            <video
              className="h-[300px] w-[300px] object-cover [mask-image:radial-gradient(circle,black_45%,transparent_70%)]"
              src={videoSrc}
              autoPlay
              muted
              loop
              playsInline
              onError={() => setVideoOk(false)}
            />
          ) : (
            <Cube size={132} spinSeconds={20} />
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

function Ring({ size, items, seconds, reverse = false, dashed = false }: { size: number; items: string[]; seconds: number; reverse?: boolean; dashed?: boolean }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 rounded-full border border-smoke/60"
      style={{
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderStyle: dashed ? "dashed" : "solid",
        animation: `${reverse ? "counter-orbit" : "orbit"} ${seconds}s linear infinite`,
      }}
    >
      {items.map((label, i) => {
        const a = (i / items.length) * Math.PI * 2;
        const x = Math.cos(a) * (size / 2) + size / 2;
        const y = Math.sin(a) * (size / 2) + size / 2;
        return (
          <div key={label} className="absolute" style={{ left: x, top: y }}>
            {/* counter-rotate so labels stay upright */}
            <div style={{ animation: `${reverse ? "orbit" : "counter-orbit"} ${seconds}s linear infinite` }}>
              <div className="relative -translate-x-1/2 -translate-y-1/2">
                {i % 3 === 0 && <span className="absolute inset-0 rounded-full border border-citrine animate-pulse-ring" style={{ animationDelay: `${i * 0.4}s` }} />}
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-graphite bg-carbon">
                  <span className={`h-1.5 w-1.5 ${i % 3 === 0 ? "bg-citrine shadow-[0_0_10px_#e5ff5d]" : "bg-bone/70"}`} />
                </div>
                <span className="absolute left-1/2 top-11 -translate-x-1/2 whitespace-nowrap font-utility text-[10px] tracking-[0.1em] text-stone">{label}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

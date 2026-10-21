"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/**
 * Transaction-boundary visual (spec §9.3). Three illustrative operations enter one
 * channel, are inspected, and leave by three exits. Plays once on first view and again
 * on request. Static under prefers-reduced-motion.
 */

const ENTRY = "M0 160 H370";
const PATHS = {
  allow: `${ENTRY} H556`,
  review: `${ENTRY} H410 V60 H556`,
  deny: `${ENTRY} H410 V260 H514`,
} as const;

const PACKETS = [
  { id: "allow", color: "#e5ff5d", begin: 0 },
  { id: "deny", color: "#ff4d4d", begin: 1.1 },
  { id: "review", color: "#b7b3a2", begin: 2.2 },
] as const;

const DURATION = 2.2;

export function BoundaryDiagram() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [run, setRun] = useState(0);
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);

  useEffect(() => {
    if (reduced) return;
    const svg = svgRef.current;
    if (!svg) return;
    let timer = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setRun(1);
          timer = window.setInterval(() => setRun((r) => r + 1), 5500);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(svg);
    return () => {
      io.disconnect();
      clearInterval(timer);
    };
  }, [reduced]);

  // Start each packet at its stagger offset; restarting cancels a run in progress.
  useEffect(() => {
    const svg = svgRef.current;
    if (!run || !svg) return;
    const packets = svg.querySelectorAll<SVGRectElement>("rect[data-packet]");
    const timers = Array.from(packets, (rect, i) =>
      window.setTimeout(() => {
        rect.querySelectorAll("animate, animateMotion").forEach((a) => (a as SVGAnimationElement).beginElement());
      }, PACKETS[i]!.begin * 1000),
    );
    packets.forEach((rect) => rect.setAttribute("opacity", "0"));
    return () => timers.forEach(clearTimeout);
  }, [run]);

  const showStatic = reduced || run === 0;

  return (
    <figure className="relative overflow-hidden rounded-[12px] border border-graphite bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <p className="label">Fig. 1 · Authorization boundary</p>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          disabled={reduced}
          className="label transition-colors hover:!text-fg disabled:opacity-40"
          aria-label="Replay the boundary animation"
        >
          ↻ Replay
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 720 320"
        className="block h-auto w-full"
        role="img"
        aria-labelledby="fig1-title fig1-desc"
      >
        <title id="fig1-title">Transaction authorization boundary</title>
        <desc id="fig1-desc">
          A proposed transaction enters a narrow channel and is inspected by the policy engine. Allowed operations continue to
          the smart account. Operations needing review branch to human approval. Denied operations stop at a solid boundary and
          are never broadcast.
        </desc>

        {/* entry channel */}
        <path d="M0 150 H250 M0 170 H250" stroke="#565656" strokeWidth="1" fill="none" />
        <text x="0" y="138" className="fill-[#9c9c9c] font-mono text-[10px] tracking-[0.08em]">PROPOSED INTENT</text>

        {/* engine */}
        <rect x="242" y="104" width="136" height="112" fill="none" stroke="#e5ff5d" strokeOpacity="0.25" rx="6">
          <animate attributeName="stroke-opacity" values="0.05;0.45;0.05" dur="2.4s" repeatCount="indefinite" />
        </rect>
        <rect x="250" y="112" width="120" height="96" fill="#111111" stroke="#e5ff5d" rx="4" />
        <text x="310" y="150" textAnchor="middle" className="fill-[#f9f9f9] font-mono text-[10px] tracking-[0.08em]">POLICY</text>
        <text x="310" y="164" textAnchor="middle" className="fill-[#f9f9f9] font-mono text-[10px] tracking-[0.08em]">ENGINE</text>
        <text x="310" y="190" textAnchor="middle" className="fill-[#565656] font-mono text-[9px]">v7 · 15 checks</text>
        {[124, 132, 140].map((x) => (
          <line key={x} x1={250 + (x - 112)} y1="112" x2={250 + (x - 112)} y2="118" stroke="#e5ff5d" />
        ))}

        {/* exits */}
        <path d="M370 160 H556" stroke="rgba(229,255,93,0.45)" fill="none" />
        <path d="M410 160 V60 H556" stroke="rgba(183,179,162,0.45)" fill="none" strokeDasharray="3 3" />
        <path d="M410 160 V260 H514" stroke="rgba(255,77,77,0.45)" fill="none" />

        {/* allow → account */}
        <rect x="556" y="136" width="150" height="48" fill="#111111" stroke="rgba(229,255,93,0.5)" />
        <text x="568" y="156" className="fill-[#e5ff5d] font-mono text-[10px] tracking-[0.08em]">→ ALLOW</text>
        <text x="568" y="172" className="fill-[#9c9c9c] font-mono text-[9px]">ERC-4337 smart account</text>

        {/* review */}
        <rect x="556" y="36" width="150" height="48" fill="#111111" stroke="rgba(183,179,162,0.5)" strokeDasharray="3 3" />
        <text x="568" y="56" className="fill-[#b7b3a2] font-mono text-[10px] tracking-[0.08em]">◆ HUMAN REVIEW</text>
        <text x="568" y="72" className="fill-[#9c9c9c] font-mono text-[9px]">Pending · unsigned</text>

        {/* deny wall */}
        <rect x="514" y="226" width="8" height="68" fill="#ff4d4d" />
        <text x="534" y="256" className="fill-[#ff4d4d] font-mono text-[10px] tracking-[0.08em]">■ DENY</text>
        <text x="534" y="272" className="fill-[#9c9c9c] font-mono text-[9px]">No signature · no broadcast</text>

        {/* packets */}
        {PACKETS.map((p) => {
          const path = PATHS[p.id];
          const end = p.id === "allow" ? [546, 160] : p.id === "review" ? [546, 60] : [504, 260];
          return (
            <g key={p.id}>
              {showStatic ? (
                <rect x={end[0]! - 4} y={end[1]! - 4} width="8" height="8" fill={p.color} />
              ) : (
                <rect data-packet x="-4" y="-4" width="8" height="8" fill={p.color} opacity="0">
                  <animate attributeName="opacity" values="0;1" dur="0.01s" begin="indefinite" fill="freeze" />
                  <animateMotion
                    path={path}
                    dur={`${DURATION}s`}
                    begin="indefinite"
                    fill="freeze"
                    calcMode="spline"
                    keyTimes="0;1"
                    keySplines="0.4 0 0.2 1"
                  />
                </rect>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="grid grid-cols-3 border-t border-line text-[10px] font-medium tracking-[0.08em]">
        <span className="border-r border-line px-4 py-2.5 text-allow">→ ALLOW</span>
        <span className="border-r border-line px-4 py-2.5 text-review">◆ REVIEW</span>
        <span className="px-4 py-2.5 text-deny">■ DENY</span>
      </figcaption>
    </figure>
  );
}

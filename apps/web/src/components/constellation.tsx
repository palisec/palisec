import type { CSSProperties } from "react";
import { Cube } from "./cube";

/**
 * Constellation of the fifteen local checks around the policy engine cube. Dashed
 * connectors flow toward the centre; a highlight sweeps the ring in evaluation order,
 * one node at a time, so the diagram reads as the sequence the engine actually runs.
 */
const CHECKS = [
  "Policy", "Schema", "Replay", "Stop", "Chain", "Deny", "Target", "Method",
  "Value", "Fee", "Price", "Budget", "Pending", "Loop", "Human",
];

const SIZE = 560;
const R = 220;
const STEP = 0.5; // seconds per check in the sweep
const CYCLE = CHECKS.length * STEP + 1.5;

export function Constellation() {
  const c = SIZE / 2;
  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[560px]" aria-label="The fifteen checks the policy engine runs, in order, around the engine">
      <style>{`
        @keyframes node-hit { 0%, 6% { background:#9cf6ee; box-shadow:0 0 18px #9cf6ee; color:#012624 } 12%, 100% { background:#012624; box-shadow:none; color:#bbc7c6 } }
        @keyframes line-hit { 0%, 6% { stroke:#9cf6ee; stroke-opacity:1 } 12%, 100% { stroke:#2c6a64; stroke-opacity:.7 } }
      `}</style>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <circle cx={c} cy={c} r={R} fill="none" stroke="#0d4440" />
        <circle cx={c} cy={c} r={R * 0.55} fill="none" stroke="#0d4440" strokeDasharray="2 6" />
        {CHECKS.map((_, i) => {
          const a = (i / CHECKS.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={i}
              x1={c + Math.cos(a) * R}
              y1={c + Math.sin(a) * R}
              x2={c + Math.cos(a) * 52}
              y2={c + Math.sin(a) * 52}
              stroke="#2c6a64"
              strokeDasharray="4 4"
              style={{ animation: `dash-flow 1.6s linear infinite, line-hit ${CYCLE}s linear ${i * STEP}s infinite` }}
            />
          );
        })}
      </svg>

      {/* Pool of light the engine sits in */}
      <div aria-hidden className="absolute left-1/2 top-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(156_246_238/0.16),rgb(156_246_238/0.04)_55%,transparent)]" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <Cube size={68} spinSeconds={14} />
      </div>

      <ol>
        {CHECKS.map((name, i) => {
          const a = (i / CHECKS.length) * Math.PI * 2 - Math.PI / 2;
          const x = ((c + Math.cos(a) * R) / SIZE) * 100;
          const y = ((c + Math.sin(a) * R) / SIZE) * 100;
          return (
            <li key={name} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full border border-reef bg-abyss font-mono text-[9.5px] text-silver sm:h-10 sm:w-10"
                style={{ animation: `node-hit ${CYCLE}s linear ${i * STEP}s infinite` } as CSSProperties}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap font-utility text-[8.5px] uppercase tracking-[0.08em] text-silver sm:text-[9.5px]">
                {name}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

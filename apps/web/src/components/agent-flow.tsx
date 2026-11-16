"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/*
 * The 2.0 hero diagram: an agent proposes, PALISEC decides, only an authorized operation reaches
 * protected execution, and the PALISEC Agent explains what happened. It cycles through the three
 * real outcomes with their real reason codes. It is an illustration, never live telemetry.
 */

type Outcome = "allow" | "deny" | "review";

const SCENES: Record<Outcome, { intent: string; checks: [string, "pass" | "fail" | "review" | "skip"][]; result: string; code: string; agent: string }> = {
  allow: {
    intent: "transfer(0xa9059cbb) · $40",
    checks: [["Policy and account", "pass"], ["Target and method", "pass"], ["Budget reservation", "pass"], ["Approval threshold", "pass"]],
    result: "AUTHORIZED",
    code: "ps_auth_…",
    agent: "Within the hourly budget and the allowlist. Authorization expires in 5 minutes; the exact payload is bound.",
  },
  deny: {
    intent: "call(0x5555…5555) · $0",
    checks: [["Policy and account", "pass"], ["Target and method", "fail"], ["Budget reservation", "skip"], ["Approval threshold", "skip"]],
    result: "DENIED",
    code: "PS_TARGET_001",
    agent: "Target is not on the allowlist; default is deny. Nothing was reserved or signed. Next: confirm whether the contract should be allowed.",
  },
  review: {
    intent: "transfer(0xa9059cbb) · $180",
    checks: [["Policy and account", "pass"], ["Target and method", "pass"], ["Budget reservation", "pass"], ["Approval threshold", "review"]],
    result: "NEEDS APPROVAL",
    code: "PS_HUMAN_001",
    agent: "Above the $150 approval threshold. Held until an approver signs this exact operation with their wallet.",
  },
};
const ORDER: Outcome[] = ["allow", "deny", "review"];

const TONE: Record<Outcome, { text: string; ring: string; bg: string }> = {
  allow: { text: "text-allow", ring: "border-allow/60", bg: "bg-allow/[0.07]" },
  deny: { text: "text-deny", ring: "border-deny/60", bg: "bg-deny/[0.07]" },
  review: { text: "text-review", ring: "border-review/60", bg: "bg-review/[0.07]" },
};

const reducedQuery = () => window.matchMedia("(prefers-reduced-motion: reduce)");
function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const q = reducedQuery();
      q.addEventListener("change", cb);
      return () => q.removeEventListener("change", cb);
    },
    () => reducedQuery().matches,
    () => true,
  );
}

const Node = ({ label, sub, active, tone }: { label: string; sub?: string; active?: boolean; tone?: string }) => (
  <div className={`rounded-[10px] border px-3 py-2 transition-[border-color,background-color,box-shadow] duration-500 ${active ? `${tone ?? "border-aqua/60"} bg-raised shadow-[0_0_0_3px_rgb(156_246_238/0.06)]` : "border-line-strong bg-ink/80"}`}>
    <p className="font-utility text-[10px] uppercase tracking-[0.12em] text-silver">{label}</p>
    {sub && <p className="mt-0.5 font-mono text-[11.5px] text-mist">{sub}</p>}
  </div>
);

const Arrow = ({ on }: { on: boolean }) => (
  <div aria-hidden className="mx-auto h-4 w-px overflow-hidden bg-line-strong">
    <div className={`h-full w-full bg-aqua transition-transform duration-500 ${on ? "translate-y-0" : "-translate-y-full"}`} />
  </div>
);

export function AgentFlow() {
  const reduced = useReducedMotion();
  // One counter drives everything: six stages per scene, three scenes in turn.
  const [tick, setTick] = useState(5);
  useEffect(() => {
    if (reduced) return;
    const step = setInterval(() => setTick((t) => t + 1), 650);
    return () => clearInterval(step);
  }, [reduced]);
  const i = Math.floor(tick / 6) % ORDER.length;
  const stage = tick % 6;

  const outcome = ORDER[i]!;
  const scene = SCENES[outcome];
  const tone = TONE[outcome];
  const s = reduced ? 5 : stage;

  return (
    <figure className="panel relative overflow-hidden p-4 text-left sm:p-5" aria-label="Illustration: an agent's proposed transaction passing through PALISEC authorization">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="label !text-[10px]">Execution boundary</p>
        <p className="font-utility text-[9.5px] uppercase tracking-[0.1em] text-lilac">◆ Illustrative · not live telemetry</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
        <div>
          <Node label="External agent" sub="LangGraph · TypeScript · MCP" active={s >= 0} />
          <Arrow on={s >= 1} />
          <Node label="Transaction proposal" sub={scene.intent} active={s >= 1} />
          <Arrow on={s >= 2} />
          <div className={`rounded-[10px] border p-3 transition-colors duration-500 ${s >= 2 ? "border-aqua/50 bg-raised/70" : "border-line-strong bg-ink/80"}`}>
            <p className="font-utility text-[10px] uppercase tracking-[0.12em] text-aqua">PALISEC authorization · deterministic</p>
            <ul className="mt-2 space-y-1">
              {scene.checks.map(([name, st], k) => {
                const shown = s >= 3 || (s === 2 && k < 2);
                const cls = !shown ? "text-dim" : st === "pass" ? "text-allow" : st === "fail" ? "text-deny" : st === "review" ? "text-review" : "text-dim";
                return (
                  <li key={name} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-soft">{name}</span>
                    <span className={`font-mono text-[10.5px] uppercase ${cls}`}>{shown ? (st === "skip" ? "skipped" : st) : "·"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <Arrow on={s >= 4} />
          <div className={`rounded-[10px] border px-3 py-2 transition-all duration-500 ${s >= 4 ? `${tone.ring} ${tone.bg}` : "border-line-strong bg-ink/80"}`}>
            <p className={`font-mono text-[12px] tracking-[0.04em] ${s >= 4 ? tone.text : "text-dim"}`}>
              {s >= 4 ? scene.result : "decision"} <span className="text-dim">· {s >= 4 ? scene.code : "…"}</span>
            </p>
          </div>
          <Arrow on={s >= 5 && outcome === "allow"} />
          <Node label="Protected execution → on-chain" sub={outcome === "allow" ? "only an authorized operation" : outcome === "deny" ? "never reached" : "after an approver signs"} active={s >= 5 && outcome === "allow"} tone="border-allow/60" />
        </div>
        <div className="flex flex-col rounded-[10px] border border-line-strong bg-ink/70 p-3">
          <p className="font-utility text-[10px] uppercase tracking-[0.12em] text-silver">PALISEC Agent · observing</p>
          <p className="mt-3 text-[12px] text-muted">Why did this happen?</p>
          <p className={`mt-1.5 text-[12.5px] leading-relaxed text-soft transition-opacity duration-500 ${s >= 4 ? "opacity-100" : "opacity-30"}`}>{scene.agent}</p>
          <p className="mt-auto pt-3 font-mono text-[10.5px] text-dim">evidence: operation · policy v7 · {scene.code}</p>
          <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-muted">The agent explains. It cannot change the decision.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Choose an outcome">
        {ORDER.map((o, k) => (
          <button key={o} type="button" onClick={() => setTick(k * 6 + 5)} aria-pressed={k === i} className={`rounded-[6px] border px-2 py-0.5 font-utility text-[10px] uppercase tracking-[0.08em] transition-colors ${k === i ? `${TONE[o].ring} ${TONE[o].text}` : "border-line-strong text-silver hover:text-mist"}`}>
            {o === "allow" ? "Allowed" : o === "deny" ? "Denied" : "Needs approval"}
          </button>
        ))}
      </div>
    </figure>
  );
}

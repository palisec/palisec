"use client";

import { Fragment, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AgentIcon, ChainIcon, CheckIcon, CloseIcon, CodeIcon, HandIcon, ShieldIcon } from "./icons";

/*
 * The execution boundary as a horizontal pipeline: an agent proposes, PALISEC decides, only an
 * authorized operation reaches execution, and the PALISEC Agent explains what happened. It cycles
 * through the three real outcomes with their real reason codes. An illustration, never telemetry.
 */

type Outcome = "allow" | "deny" | "review";
type Status = "pass" | "fail" | "review" | "skip";

const SCENES: Record<Outcome, { intent: string; value: string; checks: [string, Status][]; result: string; code: string; exec: string; agent: string }> = {
  allow: {
    intent: "transfer()",
    value: "$40 · token 0x2222…",
    checks: [["Policy and account", "pass"], ["Target and method", "pass"], ["Budget reservation", "pass"], ["Approval threshold", "pass"]],
    result: "Allowed",
    code: "ps_auth_7c1e…",
    exec: "Sent, exactly this payload",
    agent: "Within the hourly budget and the allowlist. The authorization expires in five minutes and is bound to this exact payload.",
  },
  deny: {
    intent: "call()",
    value: "$0 · contract 0x5555…",
    checks: [["Policy and account", "pass"], ["Target and method", "fail"], ["Budget reservation", "skip"], ["Approval threshold", "skip"]],
    result: "Denied",
    code: "PS_TARGET_001",
    exec: "Blocked",
    agent: "The target is not on the allowlist, and the default is deny. Nothing was reserved or signed. Next: confirm whether this contract should be allowed.",
  },
  review: {
    intent: "transfer()",
    value: "$180 · token 0x2222…",
    checks: [["Policy and account", "pass"], ["Target and method", "pass"], ["Budget reservation", "pass"], ["Approval threshold", "review"]],
    result: "Needs approval",
    code: "PS_HUMAN_001",
    exec: "Waiting for a signature",
    agent: "Above the $150 approval threshold. Held until an approver signs this exact operation with their own wallet.",
  },
};
const ORDER: Outcome[] = ["allow", "deny", "review"];
const TONE: Record<Outcome, { text: string; ring: string; bg: string }> = {
  allow: { text: "text-allow", ring: "border-allow/60", bg: "bg-allow/[0.08]" },
  deny: { text: "text-deny", ring: "border-deny/60", bg: "bg-deny/[0.08]" },
  review: { text: "text-review", ring: "border-review/60", bg: "bg-review/[0.08]" },
};
const STATUS: Record<Status, { cls: string; text: string }> = {
  pass: { cls: "text-allow", text: "pass" },
  fail: { cls: "text-deny", text: "fail" },
  review: { cls: "text-review", text: "review" },
  skip: { cls: "text-dim", text: "skipped" },
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

/** A connector that fills when the flow passes through it: horizontal on wide screens, vertical below. */
function Connector({ on, tone = "bg-aqua" }: { on: boolean; tone?: string }) {
  return (
    <div aria-hidden className="relative mx-auto h-5 w-px overflow-hidden bg-line-strong lg:mx-0 lg:h-px lg:w-full lg:self-center">
      <div className={`absolute inset-0 ${tone} transition-transform duration-500 ease-out ${on ? "translate-x-0 translate-y-0" : "-translate-y-full lg:-translate-x-full lg:translate-y-0"}`} />
    </div>
  );
}

function Stage({ title, icon, children, active, className = "" }: { title: string; icon: ReactNode; children: ReactNode; active: boolean; className?: string }) {
  return (
    <div className={`min-w-0 rounded-[12px] border p-4 transition-[border-color,background-color] duration-500 ${active ? "border-aqua/45 bg-raised/80" : "border-line-strong bg-deep/70"} ${className}`}>
      <p className="flex items-center gap-2 font-utility text-[12.5px] font-semibold text-silver">
        <span aria-hidden className={active ? "text-aqua" : "text-dim"}>{icon}</span>
        {title}
      </p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

/** A check's state as a mark, with the word kept for screen readers. */
function CheckMark({ status, shown }: { status: Status; shown: boolean }) {
  if (!shown) return <span aria-label="pending" className="h-3.5 w-3.5 rounded-full border border-dashed border-line-strong" />;
  const label = STATUS[status].text;
  if (status === "pass") return <CheckIcon size={15} strokeWidth={2.2} className="text-allow" aria-label={label} aria-hidden={false} role="img" />;
  if (status === "fail") return <CloseIcon size={15} strokeWidth={2.2} className="text-deny" aria-label={label} aria-hidden={false} role="img" />;
  if (status === "review") return <HandIcon size={15} className="text-review" aria-label={label} aria-hidden={false} role="img" />;
  return <span aria-label={label} role="img" className="h-px w-3 bg-dim" />;
}

const OUTCOME_BUTTON: Record<Outcome, { label: string; icon: ReactNode }> = {
  allow: { label: "Show an allowed transaction", icon: <CheckIcon size={16} strokeWidth={2.2} /> },
  deny: { label: "Show a denied transaction", icon: <CloseIcon size={16} strokeWidth={2.2} /> },
  review: { label: "Show a transaction that needs approval", icon: <HandIcon size={16} /> },
};

export function AgentFlow() {
  const reduced = useReducedMotion();
  // One counter drives everything: six stages per scene, three scenes in turn.
  const [tick, setTick] = useState(5);
  // An outcome the visitor picked plays from its first stage and then stays on screen.
  const [held, setHeld] = useState(false);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const step = setInterval(() => setTick((t) => (held && t % 6 === 5 ? t : t + 1)), 700);
    return () => clearInterval(step);
  }, [reduced, held, run]);
  const show = (k: number) => {
    setTick(k * 6);
    setHeld(true);
    setRun((r) => r + 1);
  };
  const i = Math.floor(tick / 6) % ORDER.length;
  const s = reduced ? 5 : tick % 6;
  const outcome = ORDER[i]!;
  const scene = SCENES[outcome];
  const tone = TONE[outcome];

  const stages = [
    <Stage key="agent" title="Your agent" icon={<AgentIcon size={16} />} active={s >= 0}>
      <p className="text-[14px] text-mist">Wants to act</p>
      <p className="mt-1 text-[12.5px] text-muted">Any framework</p>
    </Stage>,
    <Stage key="proposal" title="Proposal" icon={<CodeIcon size={16} />} active={s >= 1}>
      <p className="font-mono text-[13px] text-mist">{scene.intent}</p>
      <p className="mt-1 font-mono text-[12px] text-muted">{scene.value}</p>
    </Stage>,
    <Stage key="auth" title="PALISEC checks" icon={<ShieldIcon size={16} />} active={s >= 2}>
      <ul className="space-y-1.5">
        {scene.checks.map(([name, st], k) => {
          const shown = s >= 3 || (s === 2 && k < 2);
          return (
            <li key={name} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="truncate text-soft">{name}</span>
              <CheckMark status={st} shown={shown} />
            </li>
          );
        })}
      </ul>
    </Stage>,
    <div key="decision" className={`min-w-0 rounded-[12px] border p-4 transition-all duration-500 ${s >= 4 ? `${tone.ring} ${tone.bg}` : "border-line-strong bg-deep/70"}`}>
      <p className="font-utility text-[12.5px] font-semibold text-silver">Decision</p>
      <p className={`mt-2.5 font-heading text-[22px] leading-none tracking-[-0.02em] ${s >= 4 ? tone.text : "text-dim"}`}>{s >= 4 ? scene.result : "…"}</p>
      <p className="mt-2 font-mono text-[12px] text-muted">{s >= 4 ? scene.code : "deterministic"}</p>
    </div>,
    <Stage key="exec" title="On chain" icon={<ChainIcon size={16} />} active={s >= 5 && outcome === "allow"}>
      <p className={`text-[14px] ${outcome === "allow" ? "text-mist" : outcome === "deny" ? "text-deny" : "text-review"}`}>{s >= 5 ? scene.exec : "…"}</p>
    </Stage>,
  ];

  return (
    <figure aria-label="Illustration: a proposed transaction passing through PALISEC authorization" className="relative">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,0.85fr)_32px_minmax(0,1fr)_32px_minmax(0,1.35fr)_32px_minmax(0,0.95fr)_32px_minmax(0,0.9fr)] lg:items-stretch">
        {stages.map((el, k) => (
          <Fragment key={k}>
            {el}
            {k < stages.length - 1 && <Connector on={s >= k + 1 && (k < 3 || outcome === "allow")} tone={k === 3 ? "bg-allow" : "bg-aqua"} />}
          </Fragment>
        ))}
      </div>
      <figcaption className="mt-4 flex flex-col gap-4 rounded-[12px] border border-line-strong bg-deep/60 p-3 sm:flex-row sm:items-center">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-aqua/10 text-aqua ring-1 ring-aqua/30">
          <AgentIcon size={18} />
        </span>
        <p className={`min-w-0 flex-1 text-[14px] leading-relaxed text-soft transition-opacity duration-500 ${s >= 4 ? "opacity-100" : "opacity-70"}`}>
          <span className="sr-only">PALISEC Agent: </span>
          {scene.agent}
        </p>
        <div className="flex shrink-0 items-center gap-1 rounded-[10px] border border-line-strong p-1" role="group" aria-label="Show an outcome">
          {ORDER.map((o, k) => (
            <button
              key={o}
              type="button"
              onClick={() => show(k)}
              aria-pressed={k === i}
              aria-label={OUTCOME_BUTTON[o].label}
              title={OUTCOME_BUTTON[o].label}
              className={`grid h-8 w-8 place-items-center rounded-[7px] transition-colors ${k === i ? `${TONE[o].text} ${TONE[o].bg}` : "text-dim hover:text-mist"}`}
            >
              {OUTCOME_BUTTON[o].icon}
            </button>
          ))}
        </div>
      </figcaption>
      <p className="mt-2 text-right font-utility text-[12.5px] text-dim">Sample values</p>
    </figure>
  );
}

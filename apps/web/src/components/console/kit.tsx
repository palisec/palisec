"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { AgentStatus, AuditType, OpStatus } from "@/lib/console-sim";
import type { Decision } from "@palisec/policy-schema";
import { Codes } from "../ui";
import { useInView } from "../motion";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Compact page heading for console screens: no hero, just the task. */
export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="line-mask font-heading text-[26px] font-bold leading-none text-bone">
          <span>{title}</span>
        </h1>
        {description && <p className="mt-2 max-w-[72ch] animate-[c-fade_.5s_var(--ease-out-quint)_.15s_both] text-sm leading-relaxed text-muted">{typeof description === "string" ? <Codes text={description} /> : description}</p>}
      </div>
      {actions && <div className="flex animate-[c-fade_.5s_var(--ease-out-quint)_.25s_both] flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A lit panel; it and its rows rise in on a CSS scroll timeline (see globals.css). */
export function Panel({ title, actions, children, className = "", bodyClassName = "", id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={`panel overflow-hidden ${className}`} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line bg-[linear-gradient(180deg,rgb(255_255_240/0.025),transparent)] px-4 py-2">
          {title && <h2 className="label !text-bone">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "quiet";
const BTN: Record<BtnVariant, string> = {
  primary: "btn btn-primary px-3 py-1.5 font-utility text-[11px] font-semibold uppercase tracking-[0.06em]",
  ghost: "btn btn-ghost !px-3 !py-1.5 !text-[11px]",
  danger: "btn px-3 py-1.5 font-utility text-[11px] uppercase tracking-[0.06em] text-deny shadow-[inset_0_0_0_1px_rgb(255_82_71/0.55)] hover:bg-deny/10 hover:shadow-[inset_0_0_0_1px_rgb(255_82_71/0.8),0_8px_22px_-10px_rgb(255_82_71/0.6)]",
  quiet: "btn px-2 py-1 font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-citrine hover:shadow-[inset_0_0_0_1px_rgb(229_255_93/0.5),0_6px_18px_-10px_rgb(229_255_93/0.5)]",
};

export function Btn({ variant = "ghost", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`${BTN[variant]} justify-center active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${className}`}
    />
  );
}

export type Tone = "allow" | "deny" | "review" | "muted" | "info";
const TONE: Record<Tone, string> = {
  allow: "text-citrine shadow-[inset_0_0_0_1px_rgb(229_255_93/0.4)] bg-citrine/[0.06]",
  deny: "text-deny shadow-[inset_0_0_0_1px_rgb(255_82_71/0.5)] bg-deny/[0.06]",
  review: "text-sand border border-dashed border-sand/60",
  muted: "text-stone shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
  info: "text-bone shadow-[inset_0_0_0_1px_rgb(248_249_241/0.3)]",
};

export function Pill({ tone = "muted", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.06em] transition-colors duration-300 ${TONE[tone]} ${className}`}>{children}</span>;
}

const STATUS: Record<OpStatus, { tone: Tone; glyph: string; text: string }> = {
  denied: { tone: "deny", glyph: "■", text: "Denied" },
  authorized: { tone: "allow", glyph: "→", text: "Authorized" },
  pending_approval: { tone: "review", glyph: "◆", text: "Pending approval" },
  approved: { tone: "allow", glyph: "✓", text: "Approved" },
  rejected: { tone: "muted", glyph: "×", text: "Rejected" },
  expired: { tone: "muted", glyph: "–", text: "Expired" },
  failed: { tone: "deny", glyph: "!", text: "Invalidated" },
};
export const STATUS_LABEL = (s: OpStatus) => STATUS[s].text;

/** Keyed on status, so a state change pops the pill instead of swapping silently. */
export function OpStatusPill({ status }: { status: OpStatus }) {
  const s = STATUS[status];
  return (
    <Pill key={status} tone={s.tone} className="animate-[c-pop_.4s_var(--ease-out-quint)]">
      <span aria-hidden className={status === "pending_approval" ? "animate-pulse" : ""}>{s.glyph}</span>
      {s.text}
    </Pill>
  );
}

export function KV({ rows, className = "" }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 text-[13px] ${className}`}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="animate-[c-fade_.4s_var(--ease-out-quint)_both] border-b border-line py-2 text-muted" style={{ animationDelay: `${i * 30}ms` }}>{k}</dt>
          <dd className="min-w-0 animate-[c-fade_.4s_var(--ease-out-quint)_both] break-words border-b border-line py-2 text-soft" style={{ animationDelay: `${i * 30 + 15}ms` }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[12px] ${className}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="animate-[c-fade_.5s_var(--ease-out-quint)] px-4 py-8 text-center">
      <span aria-hidden className="mx-auto mb-3 block h-1.5 w-1.5 animate-pulse bg-smoke" />
      <p className="text-sm text-soft">{title}</p>
      {children && <div className="mx-auto mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-muted">{typeof hint === "string" ? <Codes text={hint} /> : hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-[4px] border border-graphite bg-ink px-2.5 py-1.5 font-mono text-[12.5px] text-fg transition-[border-color,box-shadow] duration-300 placeholder:text-dim focus:border-citrine focus:shadow-[0_0_0_3px_rgb(229_255_93/0.12)]";

/** Two-step confirmation for consequential actions, inline rather than modal. */
export function Confirm({
  label,
  prompt,
  confirmLabel,
  onConfirm,
  variant = "danger",
  disabled,
  disabledReason,
}: {
  label: string;
  prompt: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Btn variant={variant} disabled={disabled} title={disabled ? disabledReason : undefined} onClick={() => setOpen(true)}>
        {label}
      </Btn>
    );
  }
  return (
    <div role="group" aria-label={`Confirm: ${label}`} className="w-full origin-top animate-[c-pop_.32s_var(--ease-out-quint)] rounded-[6px] border border-line-strong bg-ink p-3 shadow-[0_14px_30px_-16px_rgb(0_0_0/0.9)]">
      <div className="text-[13px] leading-relaxed text-soft">{prompt}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn
          variant={variant}
          autoFocus
          onClick={() => {
            onConfirm();
            setOpen(false);
          }}
        >
          {confirmLabel}
        </Btn>
        <Btn variant="quiet" onClick={() => setOpen(false)}>Cancel</Btn>
      </div>
    </div>
  );
}

export function Notice({ tone = "review", children }: { tone?: "review" | "deny" | "allow"; children: ReactNode }) {
  const cls = tone === "deny" ? "border-deny/50 bg-deny/[0.05] text-soft animate-[c-notice_.4s_var(--ease-out-quint),c-shake_.4s_.35s]" : tone === "allow" ? "border-citrine/40 bg-citrine/[0.04] text-soft animate-[c-notice_.4s_var(--ease-out-quint)]" : "border-dashed border-sand/50 text-soft animate-[c-notice_.4s_var(--ease-out-quint)]";
  // Keyed on the message so every new notice slides in, not just the first.
  return (
    <div role="status" key={typeof children === "string" ? children : undefined} className={`rounded-[6px] border px-3 py-2 text-[13px] leading-relaxed ${cls}`}>
      {typeof children === "string" ? <Codes text={children} /> : children}
    </div>
  );
}

const AGENT: Record<AgentStatus, { tone: Tone; glyph: string }> = { active: { tone: "allow", glyph: "●" }, paused: { tone: "muted", glyph: "❚❚" }, revoked: { tone: "deny", glyph: "■" } };

/** One status component for agents everywhere: glyph and word, never colour alone. */
export function AgentStatusPill({ status }: { status: AgentStatus }) {
  const s = AGENT[status];
  return (
    <Pill key={status} tone={s.tone} className="animate-[c-pop_.4s_var(--ease-out-quint)]">
      <span aria-hidden className={status === "active" ? "animate-pulse" : ""}>{s.glyph}</span>
      {status}
    </Pill>
  );
}

const DECISION_CHIP: Record<Decision, [Tone, string, string]> = {
  ALLOW: ["allow", "→", "Allow"],
  DENY: ["deny", "■", "Deny"],
  REQUIRES_HUMAN_SIGNATURE: ["review", "◆", "Review"],
};
const EVENT_CHIP: Partial<Record<AuditType, [Tone, string]>> = {
  "approval.approved": ["allow", "✓"],
  "approval.rejected": ["muted", "×"],
  "approval.expired": ["muted", "–"],
  "approval.invalidated": ["muted", "!"],
  "agent.paused": ["muted", "❚❚"],
  "agent.resumed": ["muted", "▸"],
  "agent.revoked": ["deny", "■"],
  "breaker.engaged": ["deny", "■"],
  "breaker.released": ["muted", "▸"],
  "credential.revoked": ["deny", "■"],
  "credential.created": ["muted", "+"],
  "policy.activated": ["muted", "↑"],
};

/**
 * Audit event chip. One vocabulary site-wide: → allow, ■ deny / emergency, ◆ held for review, ✓ approved.
 * Decisions show the decision word; colour is reserved for decisions, approvals and emergency actions.
 */
export function EventPill({ type, decision }: { type: AuditType; decision?: Decision }) {
  if (type === "operation.evaluated" && decision) {
    const [tone, glyph, word] = DECISION_CHIP[decision];
    return (
      <Pill tone={tone}>
        <span aria-hidden>{glyph}</span>
        {word} · evaluated
      </Pill>
    );
  }
  const [tone, glyph] = EVENT_CHIP[type] ?? ["muted", "·"];
  return (
    <Pill tone={tone}>
      <span aria-hidden>{glyph}</span>
      {type}
    </Pill>
  );
}

/** Segmented filter control with a thumb that slides to the selection. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const btn = wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (btn) setThumb({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div ref={wrap} role="radiogroup" aria-label={label} className="relative inline-flex max-w-full overflow-x-auto rounded-[4px] border border-graphite [scrollbar-width:none]">
      {thumb && (
        <span
          aria-hidden
          className="absolute left-0 top-0 rounded-[2px] bg-[linear-gradient(180deg,#f4ffb0,#e5ff5d_45%,#d2ec45)] shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_4px_14px_-4px_rgb(229_255_93/0.6)] transition-[transform,width,height] duration-300 ease-[var(--ease-out-quint)]"
          style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)`, width: thumb.w, height: thumb.h }}
        />
      )}
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`relative shrink-0 whitespace-nowrap px-2.5 py-1.5 font-utility text-[10.5px] uppercase tracking-[0.05em] transition-colors duration-300 active:scale-[0.97] ${on ? `text-carbon ${thumb ? "" : "bg-citrine"}` : "text-soft hover:bg-raised"}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`ml-1.5 tabular-nums transition-colors ${on ? "text-carbon/70" : "text-dim"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Tweens from the previous value to the new one; never renders a placeholder zero. */
export function CountUp({ value, format = (n: number) => String(Math.round(n)), duration = 900, className = "" }: { value: number; format?: (n: number) => string; duration?: number; className?: string }) {
  // Starts at the real value so the first paint (and any slow hydration) never shows a false zero;
  // later changes tween from the previous value once the number is on screen.
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!seen) return;
    const start = from.current;
    let raf = 0;
    if (reducedMotion() || start === value) {
      from.current = value;
      raf = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf);
    }
    const t0 = performance.now();
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const v = start + (value - start) * (1 - Math.pow(1 - k, 4));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [seen, value, duration]);
  return (
    <span ref={ref} className={`tabular-nums ${className}`} aria-label={format(value)}>
      <span aria-hidden>{format(shown)}</span>
    </span>
  );
}

/** Horizontal meter that fills when it scrolls into view. `fraction` is 0..1. */
export function Meter({ fraction, label, danger = false }: { fraction: number; label: string; danger?: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.5);
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div ref={ref} className="h-1.5 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)} aria-label={label}>
      <div
        className={`c-meter h-full w-full rounded-full ${danger ? "bg-deny shadow-[0_0_10px_rgb(255_82_71/0.7)]" : "bg-[linear-gradient(90deg,#a3bd2a,#e5ff5d)] shadow-[0_0_10px_rgb(229_255_93/0.5)]"}`}
        style={{ transform: `scaleX(${seen ? f : 0})` }}
      />
    </div>
  );
}

const GLYPHS = "0123456789abcdef";
/** Decodes a secret character by character, like a key being minted. */
export function ScrambleText({ text, className = "" }: { text: string; className?: string }) {
  const [frame, setFrame] = useState(0);
  const settled = reducedMotion() ? text.length : Math.floor(frame * 1.6);
  useEffect(() => {
    const id = window.setInterval(() => setFrame((f) => (Math.floor(f * 1.6) >= text.length ? (clearInterval(id), f) : f + 1)), 28);
    return () => clearInterval(id);
  }, [text]);
  const out = text
    .split("")
    .map((c, i) => (i < settled || c === "_" ? c : GLYPHS[(i * 7 + frame * 13) % 16]!))
    .join("");
  return (
    <code className={className} aria-label={text}>
      <span aria-hidden>{out}</span>
    </code>
  );
}

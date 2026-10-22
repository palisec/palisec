"use client";

import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { OpStatus } from "@/lib/console-sim";

/** Compact page heading for console screens: no hero, just the task. */
export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="font-heading text-[26px] font-bold leading-none text-bone">{title}</h1>
        {description && <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className = "", bodyClassName = "", id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={`panel overflow-hidden ${className}`} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
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
  danger: "btn px-3 py-1.5 font-utility text-[11px] uppercase tracking-[0.06em] text-deny shadow-[inset_0_0_0_1px_rgb(255_82_71/0.55)] hover:bg-deny/10",
  quiet: "btn px-2 py-1 font-utility text-[10.5px] uppercase tracking-[0.06em] text-stone shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-citrine hover:shadow-[inset_0_0_0_1px_rgb(229_255_93/0.5)]",
};

export function Btn({ variant = "ghost", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button
      type="button"
      {...props}
      className={`${BTN[variant]} justify-center disabled:pointer-events-none disabled:opacity-40 ${className}`}
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
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.06em] ${TONE[tone]} ${className}`}>{children}</span>;
}

const STATUS: Record<OpStatus, { tone: Tone; glyph: string; text: string }> = {
  denied: { tone: "deny", glyph: "■", text: "Denied" },
  authorized: { tone: "allow", glyph: "→", text: "Authorized" },
  pending_approval: { tone: "review", glyph: "◆", text: "Pending approval" },
  approved: { tone: "allow", glyph: "✓", text: "Approved" },
  rejected: { tone: "muted", glyph: "×", text: "Rejected" },
  expired: { tone: "muted", glyph: "○", text: "Expired" },
  failed: { tone: "deny", glyph: "!", text: "Invalidated" },
};
export const STATUS_LABEL = (s: OpStatus) => STATUS[s].text;

export function OpStatusPill({ status }: { status: OpStatus }) {
  const s = STATUS[status];
  return (
    <Pill tone={s.tone}>
      <span aria-hidden>{s.glyph}</span>
      {s.text}
    </Pill>
  );
}

export function KV({ rows, className = "" }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={`grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 text-[13px] ${className}`}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="border-b border-line py-2 text-muted">{k}</dt>
          <dd className="min-w-0 break-words border-b border-line py-2 text-soft">{v}</dd>
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
    <div className="px-4 py-8 text-center">
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
      {hint && <p className="mt-1 text-[11.5px] leading-snug text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-[4px] border border-graphite bg-ink px-2.5 py-1.5 font-mono text-[12.5px] text-fg outline-none transition-colors placeholder:text-dim focus:border-citrine";

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
    <div role="group" aria-label={`Confirm: ${label}`} className="w-full rounded-[6px] border border-line-strong bg-ink p-3">
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
  const cls = tone === "deny" ? "border-deny/50 bg-deny/[0.05] text-soft" : tone === "allow" ? "border-citrine/40 bg-citrine/[0.04] text-soft" : "border-dashed border-sand/50 text-soft";
  return <div role="status" className={`rounded-[6px] border px-3 py-2 text-[13px] leading-relaxed ${cls}`}>{children}</div>;
}

/** Segmented filter control. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap overflow-hidden rounded-[4px] border border-graphite">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1.5 font-utility text-[10.5px] uppercase tracking-[0.05em] transition-colors ${value === o.value ? "bg-citrine text-carbon" : "text-soft hover:bg-raised"}`}
        >
          {o.label}
          {o.count !== undefined && <span className={`ml-1.5 tabular-nums ${value === o.value ? "text-carbon/70" : "text-dim"}`}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

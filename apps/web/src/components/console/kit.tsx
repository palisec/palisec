"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Codes } from "../ui";
import { useInView } from "../motion";
import { RefreshIcon } from "../icons";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Compact page heading for console screens: no hero, just the task. */
export function PageTitle({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div className="min-w-0">
        <h1 className="line-mask font-heading text-[26px] font-medium tracking-[-0.02em] leading-none text-mist">
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
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line bg-[linear-gradient(180deg,rgb(237_255_254/0.025),transparent)] px-4 py-2">
          {title && <h2 className="label !text-mist">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "quiet";
const BTN: Record<BtnVariant, string> = {
  primary: "btn btn-primary px-3 py-1.5 font-utility text-[13px] font-semibold",
  ghost: "btn btn-ghost !px-3 !py-1.5 !text-[11px]",
  danger: "btn px-3 py-1.5 font-utility text-[13px] text-deny shadow-[inset_0_0_0_1px_rgb(255_122_140/0.55)] hover:bg-deny/10 hover:shadow-[inset_0_0_0_1px_rgb(255_122_140/0.8),0_8px_22px_-10px_rgb(255_122_140/0.6)]",
  quiet: "btn px-2 py-1 font-utility text-[12.5px] text-silver shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-aqua hover:shadow-[inset_0_0_0_1px_rgb(156_246_238/0.5),0_6px_18px_-10px_rgb(156_246_238/0.5)]",
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

const ICON_BTN: Record<"quiet" | "danger", string> = {
  quiet: "text-silver shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-aqua hover:shadow-[inset_0_0_0_1px_rgb(156_246_238/0.5)]",
  danger: "text-silver shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:text-deny hover:shadow-[inset_0_0_0_1px_rgb(255_122_140/0.6)]",
};

/** Square symbol button. `label` is its accessible name and its tooltip. */
export function IconBtn({
  label,
  tone = "quiet",
  className = "",
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & { label: string; tone?: "quiet" | "danger" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[4px] transition-[color,box-shadow,transform] duration-200 active:scale-[0.92] disabled:pointer-events-none disabled:opacity-40 ${ICON_BTN[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Refresh control: the arrow turns once per click. */
export function RefreshBtn({ onClick, label = "Refresh" }: { onClick: () => void; label?: string }) {
  const [turns, setTurns] = useState(0);
  return (
    <IconBtn
      label={label}
      onClick={() => {
        setTurns((t) => t + 1);
        onClick();
      }}
    >
      <span key={turns} className={turns ? "block animate-[c-turn_.6s_var(--ease-out-quint)]" : "block"}>
        <RefreshIcon size={15} />
      </span>
    </IconBtn>
  );
}

export type Tone = "allow" | "deny" | "review" | "muted" | "info";
const TONE: Record<Tone, string> = {
  allow: "text-allow shadow-[inset_0_0_0_1px_rgb(116_223_160/0.45)] bg-allow/[0.06]",
  deny: "text-deny shadow-[inset_0_0_0_1px_rgb(255_122_140/0.5)] bg-deny/[0.06]",
  review: "text-review border border-dashed border-review/60",
  muted: "text-silver shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
  info: "text-mist shadow-[inset_0_0_0_1px_rgb(237_255_254/0.3)]",
};

export function Pill({ tone = "muted", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 font-utility text-[11.5px] transition-colors duration-300 ${TONE[tone]} ${className}`}>{children}</span>;
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
      <span aria-hidden className="mx-auto mb-3 block h-1.5 w-1.5 animate-pulse bg-drift" />
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
  "w-full rounded-[4px] border border-reef bg-ink px-2.5 py-1.5 font-mono text-[12.5px] text-fg transition-[border-color,box-shadow] duration-300 placeholder:text-dim focus:border-aqua focus:shadow-[0_0_0_3px_rgb(156_246_238/0.12)]";

/** Two-step confirmation for consequential actions, inline rather than modal. */
export function Confirm({
  label,
  prompt,
  confirmLabel,
  onConfirm,
  variant = "danger",
  disabled,
  disabledReason,
  icon,
}: {
  label: string;
  prompt: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: BtnVariant;
  disabled?: boolean;
  disabledReason?: string;
  /** Show a symbol instead of the label; the label stays as its accessible name and tooltip. */
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    if (icon)
      return (
        <IconBtn label={disabled && disabledReason ? disabledReason : label} tone="danger" disabled={disabled} onClick={() => setOpen(true)}>
          {icon}
        </IconBtn>
      );
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
  const cls = tone === "deny" ? "border-deny/50 bg-deny/[0.05] text-soft animate-[c-notice_.4s_var(--ease-out-quint),c-shake_.4s_.35s]" : tone === "allow" ? "border-allow/40 bg-allow/[0.04] text-soft animate-[c-notice_.4s_var(--ease-out-quint)]" : "border-dashed border-review/50 text-soft animate-[c-notice_.4s_var(--ease-out-quint)]";
  // Keyed on the message so every new notice slides in, not just the first.
  return (
    <div role="status" key={typeof children === "string" ? children : undefined} className={`rounded-[6px] border px-3 py-2 text-[13px] leading-relaxed ${cls}`}>
      {typeof children === "string" ? <Codes text={children} /> : children}
    </div>
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
    <div ref={wrap} role="radiogroup" aria-label={label} className="relative inline-flex max-w-full overflow-x-auto rounded-[4px] border border-reef [scrollbar-width:none]">
      {thumb && (
        <span
          aria-hidden
          className="absolute left-0 top-0 rounded-[2px] bg-[linear-gradient(180deg,#cbfffc,#9cf6ee_45%,#00827c)] shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_4px_14px_-4px_rgb(156_246_238/0.6)] transition-[transform,width,height] duration-300 ease-[var(--ease-out-quint)]"
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
            className={`relative shrink-0 whitespace-nowrap px-2.5 py-1.5 font-utility text-[12.5px] transition-colors duration-300 active:scale-[0.97] ${on ? `text-abyss ${thumb ? "" : "bg-aqua"}` : "text-soft hover:bg-raised"}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`ml-1.5 tabular-nums transition-colors ${on ? "text-abyss/70" : "text-dim"}`}>{o.count}</span>}
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
        className={`c-meter h-full w-full rounded-full ${danger ? "bg-deny" : "bg-[linear-gradient(90deg,#00827c,#9cf6ee)]"}`}
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

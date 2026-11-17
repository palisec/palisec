import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { MATURITY_LABEL, MATURITY_SHORT, type Maturity } from "@/lib/capabilities";
import { Cube } from "./cube";
import { Reveal } from "./motion";

export function Container({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`mx-auto w-full max-w-[1480px] px-[clamp(20px,4.5vw,64px)] ${className}`} {...props} />;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * A page band. With `label`, the label is the section's heading, set in a left rail beside the content
 * (sticky on wide screens), so sections read across the screen instead of down a centred column.
 */
export function Section({
  label,
  intro,
  children,
  className = "",
  id,
}: {
  /** Kept for call-site compatibility; section numbers are not shown. */
  index?: string;
  label?: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : label ? `s-${slug(label)}` : undefined;
  return (
    <section id={id} className={`relative ${className}`} aria-labelledby={label || id ? headingId : undefined}>
      <Container className="py-16 sm:py-20">
        {label ? (
          <>
            {/* Heading, then intro, then content: one left edge, read top to bottom. */}
            <div className="mb-10 max-w-[760px]">
              <h2 id={headingId} className="font-heading text-[clamp(26px,2.6vw,38px)] font-medium leading-[1.12] tracking-[-0.025em] text-mist [text-wrap:balance]">
                {label}
              </h2>
              {intro && <p className="mt-3 max-w-[60ch] text-[18px] leading-relaxed text-silver">{intro}</p>}
            </div>
            <div className="min-w-0">{children}</div>
          </>
        ) : (
          children
        )}
      </Container>
    </section>
  );
}

/** Status marks are drawn shapes; text always accompanies them, so status is never colour alone. */
const MATURITY_MARK: Record<Maturity, string> = {
  local: "bg-current",
  service: "bg-current",
  specified: "bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)] ring-1 ring-current",
  planned: "ring-1 ring-current",
};

export function MaturityBadge({ maturity }: { maturity: Maturity }) {
  const tone = maturity === "local" || maturity === "service" ? "text-aqua bg-aqua/[0.08] ring-1 ring-inset ring-aqua/35" : "text-silver ring-1 ring-inset ring-line-strong";
  return (
    <span title={MATURITY_LABEL[maturity]} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-utility text-[12.5px] font-semibold ${tone}`}>
      <span aria-hidden className={`h-[7px] w-[7px] rounded-full ${MATURITY_MARK[maturity]}`} />
      <span aria-hidden>{MATURITY_SHORT[maturity]}</span>
      <span className="sr-only">{MATURITY_LABEL[maturity]}</span>
    </span>
  );
}

export type DecisionTone = "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";

const DECISION_STYLE: Record<DecisionTone, { cls: string; text: string }> = {
  ALLOW: { cls: "text-deep bg-allow", text: "Allow" },
  DENY: { cls: "text-deny bg-deny/[0.1] ring-1 ring-inset ring-deny/60", text: "Deny" },
  REQUIRES_HUMAN_SIGNATURE: { cls: "text-review bg-review/[0.08] ring-1 ring-inset ring-review/60", text: "Needs approval" },
};

function DecisionMark({ decision }: { decision: DecisionTone }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true, className: "shrink-0" } as const;
  if (decision === "ALLOW") return <svg {...common}><path d="M1.5 5.3 4 7.6 8.5 2.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (decision === "DENY") return <svg {...common}><path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
  return <svg {...common}><path d="M5 1 9 5 5 9 1 5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
}

export function DecisionBadge({ decision, className = "" }: { decision: DecisionTone; className?: string }) {
  const s = DECISION_STYLE[decision];
  return (
    <span key={decision} className={`inline-flex animate-[pop_.45s_ease-out] items-center gap-1.5 rounded-[4px] px-2.5 py-1 font-utility text-[12px] font-semibold ${s.cls} ${className}`}>
      <DecisionMark decision={decision} />
      {s.text}
    </span>
  );
}

const BUTTON: Record<"primary" | "ghost" | "dark" | "ghost-dark", string> = {
  primary: "btn btn-solid btn-primary",
  dark: "btn btn-solid btn-dark",
  ghost: "btn btn-ghost",
  "ghost-dark": "btn btn-ghost-dark",
};

/**
 * A link styled as a button. A leading icon names the kind of destination; the trailing arrow is kept
 * for the primary action only, so a row of buttons does not repeat the same mark.
 */
export function ButtonLink({
  href,
  children,
  variant = "primary",
  icon,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "dark" | "ghost-dark";
  icon?: ReactNode;
}) {
  const arrow = !icon && (variant === "primary" || variant === "dark");
  return (
    <Link href={href} className={`group ${BUTTON[variant]}`}>
      {icon && <span aria-hidden className="-ml-0.5 shrink-0 opacity-90">{icon}</span>}
      {children}
      {arrow && (
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="shrink-0 transition-transform duration-300 group-hover:translate-x-0.5">
          <path d="M2 7h9.5M7.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </Link>
  );
}

// Reason codes, hex, request/reservation/credential IDs, API paths, method calls, decisions, PCRs, snake_case fields.
const CODE_TOKENS = /(PS_[A-Z]+_\d{3}|0x[0-9a-fA-F…]{8,}|\bps_[a-z]+_[0-9a-zA-Z_…]+|\b(?:GET|POST) \/v1\/[\w/{}]+|\b[a-z][A-Za-z]*\(\)|\b(?:ALLOW|DENY|REQUIRES_HUMAN_SIGNATURE)\b|\bPCR\d\b|\b[a-z]+(?:_[a-z]+)+\b)/g;

/** Renders codes and identifiers inside prose in the data face, so a code always looks like a code. */
export function Codes({ text }: { text: string }) {
  return (
    <>
      {text.split(CODE_TOKENS).map((part, i) =>
        i % 2 ? <code key={i} className="font-mono text-[0.86em] text-soft">{part}</code> : part,
      )}
    </>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] ${className}`}>{children}</span>;
}

/**
 * Interior page header: a large left-aligned title, with the lede and actions in the right column,
 * so the header spans the screen instead of stacking in the centre.
 */
export function PageHeader({ title, lede, compat, children }: { eyebrow?: string; title: string; lede?: ReactNode; compat?: string; children?: ReactNode }) {
  return (
    <header className="relative overflow-hidden border-b border-line">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="aurora right-[-6%] top-[-40%] h-[520px] w-[720px] bg-aqua/[0.10] animate-[drift-a_22s_ease-in-out_infinite]" />
      </div>
      <Container className="relative pb-14 pt-14 sm:pb-16 sm:pt-20">
        <div className="max-w-[860px]">
          <Reveal>
            <h1 className="display text-mist">{title}</h1>
          </Reveal>
          {lede && (
            <Reveal delay={150}>
              <p className="mt-5 max-w-[60ch] text-[clamp(18px,1.35vw,21px)] leading-relaxed text-silver">{lede}</p>
            </Reveal>
          )}
          {compat && (
            <Reveal delay={220}>
              <p className="mt-4 font-mono text-[12px] text-dim [text-wrap:balance]">{compat}</p>
            </Reveal>
          )}
          {children}
        </div>
      </Container>
      <div aria-hidden className="absolute right-[clamp(20px,5vw,72px)] top-8 hidden opacity-70 2xl:block">
        <Cube size={64} spinSeconds={26} />
      </div>
    </header>
  );
}

/** Callout for limits, caveats and corrections. */
export function Note({ kind = "note", title, children }: { kind?: "note" | "warning"; title: string; children: ReactNode }) {
  return (
    <aside className={`my-6 rounded-[12px] border px-5 py-4 ${kind === "warning" ? "border-review/40 bg-review/[0.05]" : "border-line-strong bg-raised/40"}`}>
      <p className={`mb-1.5 flex items-center gap-2 font-utility text-[13px] font-semibold ${kind === "warning" ? "text-review" : "text-aqua"}`}>
        <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
          {kind === "warning" ? (
            <path d="M7 1.5 13 12.5H1Z M7 5.5v3.2 M7 10.4v.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <path d="M7 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z M7 6.3V10 M7 4.2v.1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          )}
        </svg>
        {title}
      </p>
      <div className="text-sm leading-relaxed text-silver [&_code]:text-mist">{children}</div>
    </aside>
  );
}

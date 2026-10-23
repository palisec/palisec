import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { MATURITY_LABEL, type Maturity } from "@/lib/capabilities";
import { Cube, PixelIcon } from "./cube";
import { Reveal } from "./motion";

export function Container({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`mx-auto w-full max-w-[1280px] px-4 sm:px-8 ${className}`} {...props} />;
}

/** A full-width dark band opened by a running head: label, a rule that lights as it draws, index. */
export function Section({
  index,
  label,
  children,
  className = "",
  id,
}: {
  index?: string;
  label?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`relative ${className}`} aria-labelledby={id ? `${id}-title` : undefined}>
      <Container className="py-20 sm:py-28">
        {label && (
          <Reveal>
            <p className="label mb-14 flex items-center gap-4">
              <span className="h-1.5 w-1.5 bg-citrine shadow-[0_0_10px_2px_rgb(229_255_93/0.55)]" />
              <span className="!text-bone">{label}</span>
              <span aria-hidden className="section-rule" />
              {index && <span className="tabular-nums text-smoke">{index}</span>}
            </p>
          </Reveal>
        )}
        {children}
      </Container>
    </section>
  );
}

const MATURITY_GLYPH: Record<Maturity, string> = { local: "●", specified: "◐", planned: "○" };

/** Text always accompanies the glyph: status is never conveyed by colour alone. */
export function MaturityBadge({ maturity }: { maturity: Maturity }) {
  const tone =
    maturity === "local"
      ? "text-citrine bg-citrine/[0.07] shadow-[inset_0_0_0_1px_rgb(229_255_93/0.4),0_0_18px_-6px_rgb(229_255_93/0.5)]"
      : "text-stone shadow-[inset_0_0_0_1px_var(--color-line-strong)]";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.05em] ${tone}`}>
      <span aria-hidden>{MATURITY_GLYPH[maturity]}</span>
      {MATURITY_LABEL[maturity]}
    </span>
  );
}

export type DecisionTone = "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";

const DECISION_STYLE: Record<DecisionTone, { cls: string; glyph: string; text: string }> = {
  ALLOW: {
    cls: "text-carbon bg-[linear-gradient(180deg,#f4ffb0,#e5ff5d_45%,#d2ec45)] shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_6px_18px_-6px_rgb(229_255_93/0.6)]",
    glyph: "→",
    text: "ALLOW",
  },
  DENY: { cls: "text-deny bg-deny/[0.08] shadow-[inset_0_0_0_1px_rgb(255_82_71/0.6),0_6px_18px_-8px_rgb(255_82_71/0.55)]", glyph: "■", text: "DENY" },
  REQUIRES_HUMAN_SIGNATURE: { cls: "text-sand border border-dashed border-sand/60", glyph: "◆", text: "HUMAN REVIEW" },
};

export function DecisionBadge({ decision, className = "" }: { decision: DecisionTone; className?: string }) {
  const s = DECISION_STYLE[decision];
  return (
    <span key={decision} className={`inline-flex animate-[pop_.45s_ease-out] items-center gap-2 rounded-[4px] px-2.5 py-1 font-utility text-[10px] font-medium tracking-[0.06em] ${s.cls} ${className}`}>
      <span aria-hidden>{s.glyph}</span>
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

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "dark" | "ghost-dark";
}) {
  return (
    <Link href={href} className={`group ${BUTTON[variant]}`}>
      {(variant === "primary" || variant === "dark") && <PixelIcon dark={variant === "primary"} />}
      {children}
      {(variant === "ghost" || variant === "ghost-dark") && (
        <span aria-hidden className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
      )}
    </Link>
  );
}

// Reason codes, hex, request/reservation/credential IDs, API paths, method calls, decisions, PCRs, snake_case fields.
const CODE_TOKENS = /(RW_[A-Z]+_\d{3}|0x[0-9a-fA-F…]{8,}|\brw_[a-z]+_[0-9a-zA-Z_…]+|\b(?:GET|POST) \/v1\/[\w/{}]+|\b[a-z][A-Za-z]*\(\)|\b(?:ALLOW|DENY|REQUIRES_HUMAN_SIGNATURE)\b|\bPCR\d\b|\b[a-z]+(?:_[a-z]+)+\b)/g;

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

/** Interior page header: condensed lit capitals under a pool of light, with a spinning cube. */
export function PageHeader({ eyebrow, title, lede, compat, children }: { eyebrow: string; title: string; lede?: ReactNode; compat?: string; children?: ReactNode }) {
  return (
    <header className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="aurora right-[4%] top-[-30%] h-[460px] w-[620px] bg-citrine/[0.13] animate-[drift-a_20s_ease-in-out_infinite]" />
        <div className="aurora left-[-10%] top-[10%] h-[360px] w-[520px] bg-[#c9d89a]/[0.06] animate-[drift-b_26s_ease-in-out_infinite]" />
      </div>
      <Container className="relative grid gap-10 pb-16 pt-20 sm:pb-24 sm:pt-28 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
        <div>
          <p className="label mb-8 flex items-center gap-3">
            <span className="h-1.5 w-1.5 bg-citrine shadow-[0_0_10px_2px_rgb(229_255_93/0.55)]" />
            {eyebrow}
          </p>
          <h1 className="display max-w-[16ch] text-bone">
            {title.split(" ").reduce<string[][]>((rows, w, i) => {
              const r = Math.floor(i / 3);
              (rows[r] ??= []).push(w);
              return rows;
            }, []).map((row, i) => (
              <span key={i} className="line-mask" style={{ "--d": `${i * 90}ms` } as CSSProperties}>
                <span className="text-lit">{row.join(" ")}</span>
              </span>
            ))}
          </h1>
          {lede && (
            <Reveal delay={300}>
              <p className="mt-8 max-w-[560px] text-base leading-relaxed text-stone sm:text-lg">{lede}</p>
            </Reveal>
          )}
          {compat && (
            <Reveal delay={380}>
              <p className="label mt-6 [text-wrap:balance]">{compat}</p>
            </Reveal>
          )}
          {children}
        </div>
        <div className="hidden justify-center lg:flex">
          <Cube size={110} spinSeconds={22} />
        </div>
      </Container>
      <div className="relative mx-auto h-px max-w-[1280px] bg-gradient-to-r from-transparent via-line-strong to-transparent">
        <div className="absolute inset-x-[20%] -top-px h-[3px] bg-[radial-gradient(closest-side,rgb(229_255_93/0.5),transparent)] blur-[2px]" />
      </div>
    </header>
  );
}

/** Callout for limits, caveats and corrections. */
export function Note({ kind = "note", title, children }: { kind?: "note" | "warning"; title: string; children: ReactNode }) {
  return (
    <aside className={`panel my-6 px-5 py-4 ${kind === "warning" ? "bg-raised/60 [--panel-ring:rgb(248_249_241/0.28)]" : ""}`}>
      <p className={`label mb-1.5 ${kind === "warning" ? "!text-bone" : "!text-citrine"}`}>{kind === "warning" ? "▲ " : "● "}{title}</p>
      <div className="text-sm leading-relaxed text-stone [&_code]:text-bone">{children}</div>
    </aside>
  );
}

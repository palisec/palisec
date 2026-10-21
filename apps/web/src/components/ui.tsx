import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { MATURITY_LABEL, type Maturity } from "@/lib/capabilities";
import { Cube, PixelIcon } from "./cube";
import { Reveal } from "./motion";

export function Container({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`mx-auto w-full max-w-[1280px] px-4 sm:px-8 ${className}`} {...props} />;
}

/** A full-width dark band with an uppercase index label. */
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
            <p className="label mb-10 flex items-center gap-3">
              <span className="h-1.5 w-1.5 bg-citrine shadow-[0_0_8px_#e5ff5d]" />
              {index && <span className="text-smoke">{index}</span>}
              <span>{label}</span>
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
  const tone = maturity === "local" ? "text-citrine border-citrine/40" : "text-stone border-graphite";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.032em] ${tone}`}>
      <span aria-hidden>{MATURITY_GLYPH[maturity]}</span>
      {MATURITY_LABEL[maturity]}
    </span>
  );
}

export type DecisionTone = "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";

const DECISION_STYLE: Record<DecisionTone, { cls: string; glyph: string; text: string }> = {
  ALLOW: { cls: "text-carbon bg-citrine border-citrine", glyph: "→", text: "ALLOW" },
  DENY: { cls: "text-deny border-deny/60", glyph: "■", text: "DENY" },
  REQUIRES_HUMAN_SIGNATURE: { cls: "text-sand border-sand/60 border-dashed", glyph: "◆", text: "HUMAN REVIEW" },
};

export function DecisionBadge({ decision, className = "" }: { decision: DecisionTone; className?: string }) {
  const s = DECISION_STYLE[decision];
  return (
    <span key={decision} className={`inline-flex animate-[pop_.45s_ease-out] items-center gap-2 rounded-[4px] border px-2.5 py-1 text-xs font-medium tracking-[0.032em] ${s.cls} ${className}`}>
      <span aria-hidden>{s.glyph}</span>
      {s.text}
    </span>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost" | "dark" | "ghost-dark";
}) {
  const styles = {
    primary: "bg-citrine text-carbon px-6 py-3 text-[15px] hover:shadow-[0_0_32px_rgba(229,255,93,0.35)]",
    dark: "bg-carbon text-bone px-6 py-3 text-[15px] hover:bg-graphite",
    ghost: "border border-bone/80 text-bone px-5 py-[11px] text-[12px] uppercase tracking-[0.032em] hover:bg-bone hover:text-carbon",
    "ghost-dark": "border border-carbon text-carbon px-5 py-[11px] text-[12px] uppercase tracking-[0.032em] hover:bg-carbon hover:text-bone",
  }[variant];
  return (
    <Link href={href} className={`group inline-flex items-center gap-3 rounded-[4px] font-medium transition-all duration-300 ${styles}`}>
      {(variant === "primary" || variant === "dark") && <PixelIcon dark={variant === "primary"} />}
      {children}
    </Link>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[0.92em] ${className}`}>{children}</span>;
}

/** Interior page header: monolithic uppercase display row with a spinning cube. */
export function PageHeader({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <header className="relative overflow-hidden">
      <Container className="relative grid gap-10 pb-16 pt-20 sm:pb-24 sm:pt-28 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
        <div>
          <p className="label mb-8 flex items-center gap-3">
            <span className="h-1.5 w-1.5 bg-citrine shadow-[0_0_8px_#e5ff5d]" />
            {eyebrow}
          </p>
          <h1 className="display max-w-[16ch] text-bone">
            {title.split(" ").reduce<string[][]>((rows, w, i) => {
              const r = Math.floor(i / 3);
              (rows[r] ??= []).push(w);
              return rows;
            }, []).map((row, i) => (
              <span key={i} className="line-mask" style={{ "--d": `${i * 90}ms` } as CSSProperties}>
                <span>{row.join(" ")}</span>
              </span>
            ))}
          </h1>
          {lede && (
            <Reveal delay={300}>
              <p className="mt-8 max-w-[560px] text-base leading-relaxed text-stone sm:text-lg">{lede}</p>
            </Reveal>
          )}
          {children}
        </div>
        <div className="hidden justify-center lg:flex">
          <Cube size={110} spinSeconds={22} />
        </div>
      </Container>
      <div className="mx-auto h-px max-w-[1280px] bg-gradient-to-r from-transparent via-graphite to-transparent" />
    </header>
  );
}

/** Callout for limits, caveats and corrections. */
export function Note({ kind = "note", title, children }: { kind?: "note" | "warning"; title: string; children: ReactNode }) {
  return (
    <aside className={`my-6 rounded-[12px] border px-5 py-4 ${kind === "warning" ? "border-deny/40 bg-deny/[0.04]" : "border-graphite bg-surface"}`}>
      <p className={`label mb-1.5 ${kind === "warning" ? "!text-deny" : "!text-citrine"}`}>{kind === "warning" ? "■ " : "● "}{title}</p>
      <div className="text-sm leading-relaxed text-stone [&_code]:text-bone">{children}</div>
    </aside>
  );
}

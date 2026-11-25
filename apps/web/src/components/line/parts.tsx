import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/** Small mono label at the top of a section, on the agent side. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`t-label ${className}`}>{children}</p>;
}

/** The last phrase of a headline, in aqua. */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="text-aqua">{children}</span>;
}

type BtnProps = { href: string; children: ReactNode; variant?: "primary" | "ghost"; small?: boolean; className?: string } & Omit<ComponentProps<typeof Link>, "href" | "className">;

export function LineButton({ href, children, variant = "primary", small = false, className = "", ...rest }: BtnProps) {
  const cls = `lbtn ${variant === "primary" ? "lbtn-primary" : "lbtn-ghost"} ${small ? "sm" : ""} ${className}`;
  if (/^(https?:|mailto:)/.test(href)) {
    const external = href.startsWith("http");
    return (
      <a href={href} className={cls} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        <span className="relative">{children}</span>
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...rest}>
      <span className="relative">{children}</span>
    </Link>
  );
}

export type ResultKind = "allowed" | "held" | "blocked";
const RESULT_TONE: Record<ResultKind, string> = { allowed: "text-allow bg-allow", held: "text-review bg-review", blocked: "text-deny bg-deny" };

/** 8 px dot plus text, colored by the real result. */
export function Result({ kind, children }: { kind: ResultKind; children: ReactNode }) {
  const [text, dot] = RESULT_TONE[kind].split(" ");
  return (
    <span className={`inline-flex items-center gap-2 font-mono text-[14px] ${text}`}>
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** 8 px rounded meter: line track, aqua fill, deny at 100%. */
export function Meter({ name, value, pct }: { name: ReactNode; value: ReactNode; pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-[12.5px] text-silver">
        <span>{name}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}>
        <div className={`h-full origin-left rounded-full ${p >= 100 ? "bg-deny" : "bg-aqua"}`} style={{ transform: `scaleX(${p / 100})` }} />
      </div>
    </div>
  );
}

/** Items separated by 1 px line borders, no boxes. */
export function Rows({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`divide-y divide-line border-y border-line ${className}`}>{children}</ul>;
}

/** Framed block: only for the mandate vote, the Zolva card and console panels. */
export function Framed({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[14px] border border-line bg-[rgb(1_29_28/0.45)] ${className}`}>{children}</div>;
}

import type { ReactNode } from "react";
import { Reveal } from "../motion";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/**
 * The interior page header on the split grid, with the same props as the earlier PageHeader, so pages move to
 * the line without changing their content: label on the agent side, title and lede on the chain side.
 */
export function LinePageHeader({ eyebrow, title, lede, compat, children }: { eyebrow?: string; title: string; lede?: ReactNode; compat?: string; children?: ReactNode }) {
  return (
    <header className="split-section !pt-[10.625rem]">
      <div className="split">
        <div className="split-l min-w-0">{eyebrow ? <p className="t-label">{eyebrow}</p> : null}</div>
        <div className="split-r min-w-0 space-y-6">
          <h1 className="t-h1 text-balance">{title}</h1>
          {lede ? <p className="t-lede">{lede}</p> : null}
          {compat ? <p className="font-mono text-[0.7812rem] text-dim">{compat}</p> : null}
          {children}
        </div>
      </div>
    </header>
  );
}

/** A section on the split grid: the label (its heading) on the agent side, intro and content on the chain side. */
export function LineSection({
  label,
  intro,
  children,
  className = "",
  id,
}: {
  index?: string;
  label?: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : label ? `s-${slug(label)}` : undefined;
  // The earlier band backgrounds are dropped: sections are rows split by the line.
  const cls = className.replace(/\b(bg-[^\s]+|border-y)\b/g, "").trim();
  return (
    <section id={id} className={`split-section scroll-mt-28 ${cls}`} aria-labelledby={headingId}>
      <div className="split">
        <div className="split-l min-w-0">{label ? <h2 id={headingId} className="t-label">{label}</h2> : null}</div>
        <Reveal className="split-r min-w-0 space-y-8">
          {intro ? <p className="t-h3 max-w-[40ch] text-balance">{intro}</p> : null}
          <div className="min-w-0">{children}</div>
        </Reveal>
      </div>
    </section>
  );
}

import type { ReactNode } from "react";
import type { Maturity } from "@/lib/capabilities";
import { MaturityBadge } from "./ui";

/** Every guide states its compatibility version and maturity (spec §10). */
export function DocArticle({
  title,
  lede,
  maturity,
  compat = "Schema 1.0 · pre-release",
  children,
}: {
  title: string;
  lede?: string;
  maturity: Maturity;
  compat?: string;
  children: ReactNode;
}) {
  return (
    <article className="max-w-[780px]">
      <header className="mb-10 border-b border-line pb-8">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <MaturityBadge maturity={maturity} />
          <span className="label">{compat}</span>
        </div>
        <h1 className="text-3xl font-medium leading-tight tracking-[-0.025em] text-fg sm:text-4xl">{title}</h1>
        {lede && <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-muted">{lede}</p>}
      </header>
      <div className="prose-rw">{children}</div>
    </article>
  );
}

import type { ReactNode } from "react";

/**
 * The one contrasting band per page: a deeper kelp surface lit from its top edge, so the statement
 * inside stands apart without a bright light panel on a dark site.
 */
export function ReversalBand({ children }: { children: ReactNode; clusterImages?: { left: string; right: string } }) {
  return (
    <section className="relative overflow-hidden border-y border-line-strong bg-[linear-gradient(180deg,#003a36_0%,#012d2a_55%,#012624_100%)]">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(156_246_238/0.6)_30%,rgb(156_246_238/0.6)_70%,transparent)]" />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_15%_0%,rgb(156_246_238/0.08),transparent_70%)]" />
      <div className="relative mx-auto w-full max-w-[1480px] px-[clamp(20px,4.5vw,64px)] py-20 sm:py-24">{children}</div>
    </section>
  );
}

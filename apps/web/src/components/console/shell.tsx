"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EXAMPLE_ACCOUNT } from "@palisec/policy-schema";
import { advance, resetWorkspace, useSim, useSimNow } from "@/lib/console-store";
import { formatSimTime, shortHex } from "@/lib/units";
import { CubeGlyph } from "../cube";
import { PointerLight } from "../pointer-light";
import { Confirm } from "./kit";

const NAV = [
  { href: "/console", label: "Dashboard" },
  { href: "/console/agents", label: "Agents" },
  { href: "/console/policies", label: "Policies" },
  { href: "/console/operations", label: "Operations" },
  { href: "/console/approvals", label: "Approvals" },
  { href: "/console/audit", label: "Audit" },
  { href: "/console/security", label: "Security" },
  { href: "/console/settings", label: "Settings" },
];

const HEALTH = [
  { label: "Policy engine", value: "Local", ok: true },
  { label: "Signing", value: "Not deployed", ok: false },
  { label: "Chain", value: "Not connected", ok: false },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sim = useSim();
  const now = useSimNow();
  const pending = sim.operations.filter((o) => o.status === "pending_approval").length;

  return (
    <div className="console min-h-dvh bg-carbon">
      <PointerLight />
      <a href="#console-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-[4px] focus:bg-citrine focus:px-3 focus:py-1 focus:text-carbon">
        Skip to content
      </a>

      {/* Top bar: environment, network, account, system health */}
      <header className="sticky top-0 z-40 animate-[c-drop_.5s_var(--ease-out-quint)] border-b border-line bg-[linear-gradient(180deg,rgb(35_37_28/0.92),rgb(13_14_10/0.92))] backdrop-blur-xl">
        <div className="flex h-12 items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2" aria-label="Palisec home">
            <CubeGlyph size={16} />
            <span className="font-brand text-[15px] font-extrabold tracking-[-0.01em] text-bone">Palisec<span className="text-citrine">Wall</span></span>
          </Link>
          <span className="hidden h-5 w-px bg-line-strong sm:block" />
          <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-dashed border-sand/70 px-1.5 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.08em] text-sand" title="No mainnet or testnet environment is connected">
            ◆ Simulation
          </span>
          <dl className="hidden items-center gap-4 font-utility text-[10.5px] uppercase tracking-[0.06em] md:flex">
            <div className="flex gap-1.5"><dt className="text-dim">Network</dt><dd className="text-soft">Robinhood Chain · 4663</dd></div>
            <div className="flex gap-1.5"><dt className="text-dim">Account</dt><dd className="font-mono normal-case text-soft">{shortHex(EXAMPLE_ACCOUNT)}</dd></div>
          </dl>
          <ul aria-label="System health" className="ml-auto hidden items-center gap-3 font-utility text-[10.5px] uppercase tracking-[0.05em] xl:flex">
            {HEALTH.map((h) => (
              <li key={h.label} className="flex items-center gap-1.5">
                <span aria-hidden className={h.ok ? "tick-dot" : "h-1.5 w-1.5 rounded-full bg-smoke"} />
                <span className="text-dim">{h.label}</span>
                <span className={h.ok ? "text-soft" : "text-stone"}>{h.value}</span>
              </li>
            ))}
          </ul>
          <Link href="/" className="ml-auto whitespace-nowrap font-utility text-[10.5px] uppercase tracking-[0.08em] text-stone transition-colors hover:text-citrine xl:ml-4">Exit to site</Link>
        </div>
        {/* Scroll progress: a beam along the bottom edge of the bar */}
        <div aria-hidden className="c-progress absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,#e5ff5d_40%,#f6ffc2)] shadow-[0_0_10px_#e5ff5d]" />
      </header>

      {sim.breakers.global_stop && (
        <div role="alert" className="c-alarm border-b border-deny/50 bg-deny/[0.08] px-4 py-2 text-[13px] text-soft">
          <span className="font-utility text-[10.5px] uppercase tracking-[0.08em] text-deny"><span aria-hidden className="inline-block animate-pulse">■</span> Global stop engaged</span>
          <span className="ml-3">Every new protected execution is denied with RW_PAUSED_001.</span>
          <Link href="/console/security#breakers" className="ml-3 text-bone underline decoration-deny/60 underline-offset-4">Review circuit breakers</Link>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)]">
        <nav aria-label="Console" className="border-b border-line lg:sticky lg:top-12 lg:h-[calc(100dvh-3rem)] lg:border-b-0 lg:border-r">
          <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-4">
            {NAV.map((n) => {
              const active = n.href === "/console" ? pathname === "/console" : pathname.startsWith(n.href);
              return (
                <li key={n.href} className="shrink-0 animate-[c-fade_.45s_var(--ease-out-quint)_both]" style={{ animationDelay: `${80 + NAV.indexOf(n) * 40}ms` }}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`group flex items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-[13.5px] transition-[background-color,color,transform] duration-300 hover:translate-x-0.5 ${
                      active ? "bg-raised text-bone shadow-[inset_0_1px_0_rgb(255_255_240/0.06)]" : "text-stone hover:bg-raised/60 hover:text-bone"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden className={`h-1.5 w-1.5 transition-all duration-500 ${active ? "scale-125 bg-citrine shadow-[0_0_10px_2px_rgb(229_255_93/0.6)]" : "bg-line-strong group-hover:bg-stone"}`} />
                      {n.label}
                    </span>
                    {n.href === "/console/approvals" && pending > 0 && (
                      <span key={pending} className="c-badge animate-[c-pop_.4s_var(--ease-out-quint)] rounded-[4px] border border-dashed border-sand/60 px-1 font-mono text-[10px] text-sand" aria-label={`${pending} pending`}>{pending}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="hidden space-y-3 border-t border-line px-4 py-4 lg:block">
            <div>
              <p className="label !text-[10px]">Simulated clock</p>
              <p className="mt-1 font-mono text-[11px] text-soft">
                {formatSimTime(now).slice(0, 11)}
                <span key={now} className="animate-[c-flash_.8s_ease-out]">{formatSimTime(now).slice(11)}</span>
              </p>
              <div className="mt-2 flex gap-1.5">
                {[60, 900].map((s) => (
                  <button key={s} type="button" onClick={() => advance(s)} className="rounded-[4px] border border-line-strong px-1.5 py-0.5 font-mono text-[10.5px] text-stone transition-colors hover:border-citrine hover:text-citrine" aria-label={`Advance simulated clock by ${s / 60} minutes`}>
                    +{s / 60}m
                  </button>
                ))}
              </div>
            </div>
            <Confirm
              label="Reset workspace"
              variant="quiet"
              prompt="Restore the seeded example data. Everything you changed in this browser is discarded."
              confirmLabel="Reset"
              onConfirm={resetWorkspace}
            />
          </div>
        </nav>

        <main id="console-main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <p className="mb-6 animate-[c-fade_.5s_var(--ease-out-quint)] rounded-[6px] border border-dashed border-sand/40 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
            <span className="font-utility text-[10px] uppercase tracking-[0.08em] text-sand">Simulation workspace · </span>
            Example data evaluated by the canonical local evaluator and kept in this browser only. Nothing is signed, submitted or sent to a server. The
            authenticated production console needs the control plane, which is not deployed.
          </p>
          {children}
        </main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { EXAMPLE_ACCOUNT } from "@palisec/policy-schema";
import { advance, resetWorkspace, useSim, useSimNow } from "@/lib/console-store";
import { formatSimTime, shortHex } from "@/lib/units";
import { CubeGlyph } from "../cube";
import { PointerLight } from "../pointer-light";
import { Confirm } from "./kit";
import { api, ConsoleSessionProvider, useConsoleSession, useLive } from "./live/session";

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

const SIM_HEALTH = [
  { label: "Policy engine", value: "Local", ok: true },
  { label: "Signing", value: "Not deployed", ok: false },
  { label: "Chain", value: "Not connected", ok: false },
];

const LIVE_HEALTH = [
  { label: "Policy engine", value: "Server", ok: true },
  { label: "Signing", value: "Not deployed", ok: false },
  { label: "Chain", value: "Testnet", ok: true },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <ConsoleSessionProvider>
      <Shell>{children}</Shell>
    </ConsoleSessionProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const sim = useSim();
  const now = useSimNow();
  const session = useConsoleSession();
  const live = session.mode === "live";
  const liveOrg = useLive<{ name: string; emergency_stop: boolean }>(live ? "/organization" : null);
  const liveSummary = useLive<{ pending_approvals: number }>(live ? "/summary" : null);
  const pending = live ? (liveSummary.data?.pending_approvals ?? 0) : sim.operations.filter((o) => o.status === "pending_approval").length;
  const stopped = live ? liveOrg.data?.emergency_stop === true : sim.breakers.global_stop;
  const HEALTH = live ? LIVE_HEALTH : SIM_HEALTH;
  const network = live ? "Robinhood Testnet · 46630" : "Robinhood Chain · 4663";
  const accountLabel = live ? "Signed in" : "Account";
  const account = live && session.me ? session.me.address : EXAMPLE_ACCOUNT;

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
  }

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
          {live ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] bg-citrine/[0.06] px-1.5 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.08em] text-citrine shadow-[inset_0_0_0_1px_rgb(229_255_93/0.4)]" title="Your organization's real data on Robinhood Chain Testnet">
              ● Live · Testnet
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 font-utility text-[9.5px] uppercase tracking-[0.08em] text-bone shadow-[inset_0_0_0_1px_rgb(248_249_241/0.35)]" title="Example data in this browser; no network is connected">
              ◆ Simulation
            </span>
          )}
          <dl className="hidden items-center gap-4 font-utility text-[10.5px] uppercase tracking-[0.06em] md:flex">
            <div className="flex gap-1.5"><dt className="text-dim">Network</dt><dd className="text-soft">{network}</dd></div>
            <div className="flex gap-1.5"><dt className="text-dim">{accountLabel}</dt><dd className="font-mono normal-case text-soft">{shortHex(account)}</dd></div>
          </dl>
          <ul aria-label="System health" className="ml-auto hidden items-center gap-3 font-utility text-[10.5px] uppercase tracking-[0.05em] xl:flex">
            {HEALTH.map((h) => (
              <li key={h.label} className="flex items-center gap-1.5">
                <span aria-hidden className={h.ok ? "text-citrine" : "text-stone"}>{h.ok ? "●" : "○"}</span>
                <span className="text-dim">{h.label}</span>
                <span className={h.ok ? "text-soft" : "text-stone"}>{h.value}</span>
              </li>
            ))}
          </ul>
          <Link href="/" className="ml-auto whitespace-nowrap font-utility text-[10.5px] uppercase tracking-[0.08em] text-stone transition-colors hover:text-citrine xl:ml-4">Exit to site</Link>
        </div>
        {/* Phones: the same context in a second, scrollable row */}
        <dl className="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap border-t border-line px-4 py-1.5 font-utility text-[10px] uppercase tracking-[0.05em] md:hidden">
          <div className="flex gap-1.5"><dt className="text-dim">Network</dt><dd className="text-soft">{network}</dd></div>
          <div className="flex gap-1.5"><dt className="text-dim">{accountLabel}</dt><dd className="font-mono normal-case text-soft">{shortHex(account)}</dd></div>
          {HEALTH.map((h) => (
            <div key={h.label} className="flex items-center gap-1.5">
              <dt className="text-dim">{h.label}</dt>
              <dd className={h.ok ? "text-citrine" : "text-stone"}>{h.ok ? "● " : "○ "}{h.value}</dd>
            </div>
          ))}
        </dl>
        <dl className="hidden gap-4 whitespace-nowrap border-t border-line px-4 py-1.5 font-utility text-[10px] uppercase tracking-[0.05em] md:flex xl:hidden">
          {HEALTH.map((h) => (
            <div key={h.label} className="flex items-center gap-1.5">
              <dt className="text-dim">{h.label}</dt>
              <dd className={h.ok ? "text-citrine" : "text-stone"}>{h.ok ? "● " : "○ "}{h.value}</dd>
            </div>
          ))}
        </dl>
        {/* Scroll progress: a beam along the bottom edge of the bar */}
        <div aria-hidden className="c-progress absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,#e5ff5d_40%,#f6ffc2)] shadow-[0_0_10px_#e5ff5d]" />
      </header>

      {stopped && (
        <div role="alert" className="c-alarm border-b border-deny/50 bg-deny/[0.08] px-4 py-2 text-[13px] text-soft">
          <span className="font-utility text-[10.5px] uppercase tracking-[0.08em] text-deny"><span aria-hidden className="inline-block animate-pulse">■</span> Global stop engaged</span>
          <span className="ml-3">Every new protected execution is denied with <code className="font-mono text-[0.9em]">RW_PAUSED_001</code>.</span>
          <Link href="/console/security" className="ml-3 text-bone underline decoration-deny/60 underline-offset-4">{live ? "Review the emergency stop" : "Review circuit breakers"}</Link>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)]">
        <nav aria-label="Console" className="border-b border-line lg:sticky lg:top-[4.75rem] lg:h-[calc(100dvh-4.75rem)] xl:top-12 xl:h-[calc(100dvh-3rem)] lg:border-b-0 lg:border-r">
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
          {live ? (
            <div className="hidden space-y-3 border-t border-line px-4 py-4 lg:block">
              <div>
                <p className="label !text-[10px]">Organization</p>
                {session.me && session.me.organizations.length > 1 ? (
                  <select
                    aria-label="Organization"
                    value={session.org?.id ?? ""}
                    onChange={(e) => session.setOrgId(e.target.value)}
                    className="mt-1 w-full rounded-[4px] border border-graphite bg-ink px-2 py-1 text-[12px] text-fg"
                  >
                    {session.me.organizations.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 truncate text-[12.5px] text-soft">{liveOrg.data?.name ?? session.org?.name}</p>
                )}
                <p className="mt-1 font-utility text-[10px] uppercase tracking-[0.06em] text-dim">Role · {session.org?.role}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => session.preferSimulation(true)} className="rounded-[4px] border border-line-strong px-1.5 py-0.5 font-utility text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:border-citrine hover:text-citrine">
                  Open simulation
                </button>
                <button type="button" onClick={signOut} className="rounded-[4px] border border-line-strong px-1.5 py-0.5 font-utility text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:border-citrine hover:text-citrine">
                  Sign out
                </button>
              </div>
            </div>
          ) : (
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
          )}
        </nav>

        <main id="console-main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          {live ? (
            <p className="mb-6 animate-[c-fade_.5s_var(--ease-out-quint)] rounded-[6px] border border-citrine/30 bg-citrine/[0.03] px-3 py-2 text-[12.5px] leading-relaxed text-muted">
              <span className="font-utility text-[10px] uppercase tracking-[0.08em] text-citrine">● Live testnet workspace · </span>
              Your organization&apos;s real agents, policies and decisions. Palisec records and enforces each authorization decision, but does not sign or
              broadcast yet: your agent sends the transaction itself after an ALLOW, and nothing on-chain blocks a transaction that skips Palisec.
            </p>
          ) : (
            <p className="mb-6 animate-[c-fade_.5s_var(--ease-out-quint)] rounded-[6px] border border-dashed border-line-strong px-3 py-2 text-[12.5px] leading-relaxed text-muted">
              <span className="font-utility text-[10px] uppercase tracking-[0.08em] text-bone">◆ Simulation workspace · </span>
              Example data evaluated by the canonical local evaluator and kept in this browser only. Nothing is signed, submitted or sent to a server.{" "}
              {session.me ? (
                <button type="button" onClick={() => session.preferSimulation(false)} className="text-bone underline decoration-citrine/60 underline-offset-4 hover:text-citrine">
                  Return to your live workspace
                </button>
              ) : (
                <Link href="/login" className="text-bone underline decoration-citrine/60 underline-offset-4 hover:text-citrine">
                  Sign in with a wallet for the live testnet console
                </Link>
              )}
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

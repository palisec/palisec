"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { network as networkOf, networkLabel } from "@/lib/networks";
import { shortHex } from "@/lib/units";
import { BrandMark } from "../brand-mark";
import { CommandMenu } from "../command-menu";
import { SignOutIcon } from "../icons";
import { executionState, findCheck, useHealth } from "./live/health";
import { api, ConsoleSessionProvider, useConsoleSession, useLive } from "./live/session";
import { PendingBanner } from "./live/pending-banner";

/**
 * The network the console works on. Mainnet moves real funds, so it is drawn in the caution colour;
 * when only testnet is enabled this is a plain badge, not a control.
 */
function NetworkSwitch() {
  const { network, networks, setNetwork } = useConsoleSession();
  const tone = (id: number) => (networkOf(id)?.testnet === false ? "text-review bg-review/[0.08] shadow-[inset_0_0_0_1px_rgb(255_200_120/0.45)]" : "text-aqua bg-aqua/[0.06] shadow-[inset_0_0_0_1px_rgb(156_246_238/0.4)]");
  if (networks.length < 2)
    return (
      <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[4px] px-1.5 py-0.5 font-utility text-[11.5px] ${tone(network)}`} title={networkLabel(network)}>
        ● {networkOf(network)?.short ?? network}
      </span>
    );
  return (
    <div role="group" aria-label="Network" className="inline-flex shrink-0 items-center gap-0.5 rounded-[6px] p-0.5 shadow-[inset_0_0_0_1px_var(--color-line-strong)]">
      {networks.map((n) => {
        const on = n.chain_id === network;
        return (
          <button
            key={n.chain_id}
            type="button"
            aria-pressed={on}
            title={networkLabel(n.chain_id)}
            onClick={() => setNetwork(n.chain_id)}
            className={`whitespace-nowrap rounded-[4px] px-2 py-0.5 font-utility text-[11.5px] transition-colors ${on ? tone(n.chain_id) : "text-dim hover:text-mist"}`}
          >
            {on ? "● " : ""}
            {networkOf(n.chain_id)?.short ?? n.chain_id}
          </button>
        );
      })}
    </div>
  );
}

/** Grouped as in the 2.0 console; each entry is an existing or additive route. */
const NAV: { href: string; label: string; group?: string }[] = [
  { href: "/console", label: "Overview", group: "Control" },
  { href: "/console/agents", label: "Agents" },
  { href: "/console/smart-accounts", label: "Smart accounts" },
  { href: "/console/policies", label: "Policies" },
  { href: "/console/approvals", label: "Approvals" },
  { href: "/console/mandates", label: "Mandates" },
  { href: "/console/security", label: "Emergency stop" },
  { href: "/console/operations", label: "Operations", group: "Activity" },
  { href: "/console/audit", label: "Audit" },
  { href: "/console/security-events", label: "Security events" },
  { href: "/console/agent", label: "Palisec Agent" },
  { href: "/console/usage", label: "Usage", group: "Account" },
  { href: "/console/billing", label: "Billing" },
  { href: "/console/integrations", label: "Integrations" },
  { href: "/console/settings", label: "Settings" },
];

/** The page title for the top bar: the menu label, or "Section / item" on detail pages. */
function titleFor(pathname: string): string {
  const exact = NAV.find((n) => n.href === pathname);
  if (exact) return exact.label;
  const parent = NAV.filter((n) => n.href !== "/console" && pathname.startsWith(`${n.href}/`)).sort((x, y) => y.href.length - x.href.length)[0];
  if (!parent) return "Console";
  const rest = decodeURIComponent(pathname.slice(parent.href.length + 1).split("/")[0] ?? "");
  return rest ? `${parent.label} / ${rest.length > 18 ? `${rest.slice(0, 8)}…` : rest}` : parent.label;
}

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
  const session = useConsoleSession();
  const ready = session.status === "ready";
  const org = useLive<{ name: string; emergency_stop: boolean }>(ready ? "/organization" : null);
  const summary = useLive<{ pending_approvals: number }>(ready ? "/summary" : null);
  const health = useHealth(ready);
  const pending = summary.data?.pending_approvals ?? 0;
  // Reported only from the real health endpoint; nothing is shown as up before it answers.
  const db = findCheck(health, "database");
  const engine = findCheck(health, "policy_engine");
  const exec = executionState(health, session.network);
  const unknown = health === "unreachable" ? "Unknown" : "…";
  const HEALTH = [
    { label: "Database", value: db ? (db.ok ? "OK" : "Not running") : unknown, ok: db?.ok === true },
    { label: "Policy engine", value: engine ? (engine.ok ? "Rust + ref" : "Not running") : unknown, ok: engine?.ok === true },
    { label: "Execution", value: exec.ok === null ? unknown : exec.ok ? "Operational" : "Not running", ok: exec.ok === true },
  ];
  const live = networkOf(session.network)?.testnet === false;

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
  }

  return (
    <div className="console min-h-dvh bg-abyss lg:grid lg:grid-cols-[300px_minmax(0,1fr)]">
      <CommandMenu />
      <a href="#console-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-[4px] focus:bg-aqua focus:px-3 focus:py-1 focus:text-abyss">
        Skip to content
      </a>

      {/* Sidebar: its right edge is the line. */}
      <aside className="relative border-b border-line bg-deep lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0">
        <div aria-hidden className="console-line hidden lg:block" />
        <div className="flex items-center justify-between gap-3 px-6 pb-4 pt-6">
          <Link href="/" className="flex items-center gap-3" aria-label="Palisec home">
            <BrandMark size={28} />
            <span className="font-brand text-[20px] font-medium tracking-[-0.02em] text-mist">Palisec</span>
          </Link>
        </div>
        {ready && (
          <div className="px-6 pb-4">
            {session.me && session.me.organizations.length > 1 ? (
              <select
                aria-label="Organization"
                value={session.org?.id ?? ""}
                onChange={(e) => session.setOrgId(e.target.value)}
                className="w-full rounded-[8px] border border-line-strong bg-deep px-3 py-2.5 text-[14px] text-mist"
              >
                {session.me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            ) : (
              <div className="rounded-[8px] border border-line-strong px-3 py-2.5">
                <p className="truncate text-[14px] text-mist">{org.data?.name ?? session.org?.name}</p>
                <p className="font-mono text-[11.5px] text-dim">{session.org?.role}</p>
              </div>
            )}
          </div>
        )}
        <nav aria-label="Console" className="min-h-0 flex-1 overflow-y-auto">
          <ul className="flex gap-1 overflow-x-auto px-4 pb-3 lg:flex-col lg:gap-0.5 lg:overflow-visible">
            {NAV.map((n) => {
              const active = n.href === "/console" ? pathname === "/console" : pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <li key={n.href} className="shrink-0">
                  {n.group && <p className="hidden px-3 pb-2 pt-5 font-mono text-[11px] uppercase tracking-[0.18em] text-dim lg:block">{n.group}</p>}
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center justify-between gap-3 rounded-[6px] px-3 py-2 font-utility text-[14.5px] font-medium transition-colors ${
                      active ? "bg-aqua/[0.09] text-aqua" : "text-silver hover:bg-raised/50 hover:text-mist"
                    }`}
                  >
                    {n.label}
                    {n.href === "/console/approvals" && pending > 0 && (
                      <span key={pending} className="rounded-full bg-review/15 px-2 font-mono text-[11px] text-review" aria-label={`${pending} pending`}>{pending}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {ready && (
          <div className="hidden items-center justify-between gap-3 border-t border-line px-6 py-4 lg:flex">
            <span className="font-mono text-[13px] text-silver">{session.me ? shortHex(session.me.address) : "…"}</span>
            <button type="button" onClick={signOut} className="inline-flex items-center gap-2 font-utility text-[13.5px] text-silver hover:text-aqua">
              <SignOutIcon size={15} /> Sign out
            </button>
          </div>
        )}
      </aside>

      <div className="min-w-0">
        {/* Top bar: page title, network, search, system health. */}
        <header className="sticky top-0 z-40 border-b border-line bg-abyss/90 backdrop-blur-xl">
          <div className="flex min-h-[84px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 sm:px-8">
            <p className="mr-auto font-heading text-[24px] font-medium tracking-[-0.02em] text-mist">{titleFor(pathname)}</p>
            {live ? (
              <span className="rounded-full border border-review/50 bg-review/10 px-3 py-1 font-mono text-[12px] text-review">● Mainnet · real funds</span>
            ) : (
              <span className="rounded-full border border-line-strong px-3 py-1 font-mono text-[12px] text-silver">{networkLabel(session.network, "short")}</span>
            )}
            <NetworkSwitch />
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("palisec:search"))}
              className="hidden items-center gap-6 rounded-[6px] border border-line-strong px-3 py-2 font-utility text-[13.5px] text-dim hover:border-aqua/50 hover:text-silver md:inline-flex"
            >
              Search <kbd className="rounded-[4px] border border-line-strong px-1.5 font-mono text-[11px]">⌘K</kbd>
            </button>
            {ready && (
              <button type="button" onClick={signOut} aria-label="Sign out" className="text-silver hover:text-aqua lg:hidden">
                <SignOutIcon size={16} />
              </button>
            )}
          </div>
          <ul aria-label="System health" className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-4 py-2 font-utility text-[12.5px] sm:px-8">
            {HEALTH.map((h) => (
              <li key={h.label} className="flex items-center gap-1.5">
                <span aria-hidden className={h.ok ? "text-aqua" : "text-silver"}>{h.ok ? "●" : "○"}</span>
                <span className="text-dim">{h.label}</span>
                <span className={h.ok ? "text-soft" : "text-silver"}>{h.value}</span>
              </li>
            ))}
            <li className="ml-auto"><Link href="/docs" className="text-silver hover:text-aqua">Docs</Link></li>
          </ul>
        </header>

        {org.data?.emergency_stop && (
          <div role="alert" className="c-alarm border-b border-deny/50 bg-deny/[0.08] px-4 py-2 text-[13px] text-soft sm:px-8">
            <span className="font-utility text-[12.5px] text-deny"><span aria-hidden className="inline-block animate-pulse">■</span> Emergency stop engaged</span>
            <span className="ml-3">Every new operation in this organization is denied with <code className="font-mono text-[0.9em]">PS_PAUSED_001</code>.</span>
            <Link href="/console/security" className="ml-3 text-mist underline decoration-deny/60 underline-offset-4">Review the emergency stop</Link>
          </div>
        )}

        <main id="console-main" className="min-w-0 px-4 py-8 sm:px-8">
          {session.status === "loading" && <p className="py-10 text-center font-utility text-[13px] text-dim">Checking your session…</p>}
          {session.status === "unavailable" && (
            <div role="alert" className="max-w-[60ch] py-10">
              <p className="font-mono text-xs tracking-[0.08em] text-deny">■ PS_STATE_001 · SERVICE UNAVAILABLE</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">The console could not reach the control plane. Nothing was changed. Try again in a moment.</p>
              <button type="button" onClick={() => window.location.reload()} className="btn btn-ghost mt-6">Try again</button>
            </div>
          )}
          {session.status === "no_org" && (
            <div className="max-w-[60ch] py-10">
              <p className="font-mono text-xs tracking-[0.08em] text-lilac">◆ NO ORGANIZATION</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                This wallet is not a member of any organization. Ask an owner to add <span className="font-mono text-soft">{session.me?.address}</span> in their Settings, then sign in again.
              </p>
              <button type="button" onClick={signOut} className="btn btn-ghost mt-6">Sign out</button>
            </div>
          )}
          {ready && (
            <>
              <p className="mb-6 animate-[c-fade_.5s_var(--ease-out-quint)] rounded-[6px] border border-line-strong px-3 py-2 text-[12.5px] leading-relaxed text-muted">
                <span className={`font-utility text-[12px] ${live ? "text-review" : "text-aqua"}`}>{live ? "● Mainnet · real funds · start with small balances · " : "● Testnet · "}</span>
                Palisec records and enforces each authorization decision. Agents with a Palisec smart account are enforced on chain: Palisec
                co-signs only what it allowed. An agent that sends from a plain key is only as safe as its own code.{" "}
                <Link href="/security" className="text-mist underline decoration-line-strong underline-offset-4 hover:text-aqua">What this protects</Link>
              </p>
              <PendingBanner />
              {children}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { network as networkOf, networkLabel } from "@/lib/networks";
import { shortHex } from "@/lib/units";
import { BrandMark } from "../brand-mark";
import { PointerLight } from "../pointer-light";
import { SignOutIcon } from "../icons";
import { IconBtn } from "./kit";
import { api, ConsoleSessionProvider, useConsoleSession, useLive } from "./live/session";

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
  { href: "/console", label: "Dashboard", group: "Overview" },
  { href: "/console/agents", label: "Agents", group: "Security" },
  { href: "/console/smart-accounts", label: "Smart accounts" },
  { href: "/console/policies", label: "Policies" },
  { href: "/console/operations", label: "Operations" },
  { href: "/console/approvals", label: "Approvals" },
  { href: "/console/audit", label: "Audit" },
  { href: "/console/security-events", label: "Security events" },
  { href: "/console/security", label: "Emergency stop" },
  { href: "/console/agent", label: "PALISEC Agent", group: "Intelligence" },
  { href: "/console/integrations", label: "Integrations", group: "Connect" },
  { href: "/console/usage", label: "Usage" },
  { href: "/console/settings", label: "Settings", group: "Settings" },
];

interface Health {
  components: Record<string, string>;
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
  const health = useLive<Health>(ready ? "/health" : null);
  const pending = summary.data?.pending_approvals ?? 0;
  const c = health.data?.components;
  // Reported only from the real health endpoint; nothing is shown as up before it answers.
  const HEALTH = [
    { label: "Database", value: c ? (c.database === "ok" ? "OK" : c.database) : "…", ok: c?.database === "ok" },
    { label: "Policy engine", value: c ? (c.policy_engine === "ok" ? "Rust + ref" : c.policy_engine) : "…", ok: c?.policy_engine === "ok" },
    (() => {
      const on = session.network === 4663 ? c?.mainnet_signer === "mainnet_cosigner" : c?.signer === "testnet_cosigner";
      return { label: "Co-signer", value: c ? (on ? "Configured" : "Not configured") : "…", ok: on };
    })(),
  ];
  const live = networkOf(session.network)?.testnet === false;

  async function signOut() {
    await api("/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
  }

  return (
    <div className="console min-h-dvh bg-abyss">
      <PointerLight />
      <a href="#console-main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-[4px] focus:bg-aqua focus:px-3 focus:py-1 focus:text-abyss">
        Skip to content
      </a>

      {/* Top bar: environment, network, account, system health (spec §11.1) */}
      <header className="sticky top-0 z-40 animate-[c-drop_.5s_var(--ease-out-quint)] border-b border-line bg-[linear-gradient(180deg,rgb(0_55_52/0.92),rgb(1_38_36/0.92))] backdrop-blur-xl">
        <div className="flex h-12 items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2" aria-label="Palisec overview">
            <BrandMark size={20} />
            <span className="font-brand text-[15px] font-semibold tracking-[-0.03em] text-mist">Pali<span className="text-aqua">sec</span></span>
          </Link>
          <span className="hidden h-5 w-px bg-line-strong sm:block" />
          <NetworkSwitch />
          <dl className="hidden items-center gap-4 font-utility text-[12.5px] md:flex">
            <div className="flex gap-1.5"><dt className="text-dim">Network</dt><dd className="text-soft">{networkLabel(session.network)}</dd></div>
            <div className="flex gap-1.5"><dt className="text-dim">Signed in</dt><dd className="font-mono normal-case text-soft">{session.me ? shortHex(session.me.address) : "…"}</dd></div>
          </dl>
          <ul aria-label="System health" className="ml-auto hidden items-center gap-3 font-utility text-[12.5px] xl:flex">
            {HEALTH.map((h) => (
              <li key={h.label} className="flex items-center gap-1.5">
                <span aria-hidden className={h.ok ? "text-aqua" : "text-silver"}>{h.ok ? "●" : "○"}</span>
                <span className="text-dim">{h.label}</span>
                <span className={h.ok ? "text-soft" : "text-silver"}>{h.value}</span>
              </li>
            ))}
          </ul>
          <Link href="/docs" className="ml-auto whitespace-nowrap font-utility text-[12.5px] text-silver transition-colors hover:text-aqua xl:ml-4">Docs</Link>
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap border-t border-line px-4 py-1.5 font-utility text-[12px] xl:hidden">
          <div className="flex gap-1.5 md:hidden"><dt className="text-dim">Network</dt><dd className="text-soft">{networkLabel(session.network, "short")}</dd></div>
          {HEALTH.map((h) => (
            <div key={h.label} className="flex items-center gap-1.5">
              <dt className="text-dim">{h.label}</dt>
              <dd className={h.ok ? "text-aqua" : "text-silver"}>{h.ok ? "● " : "○ "}{h.value}</dd>
            </div>
          ))}
        </dl>
        <div aria-hidden className="c-progress absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,#9cf6ee_40%,#cbfffc)]" />
      </header>

      {org.data?.emergency_stop && (
        <div role="alert" className="c-alarm border-b border-deny/50 bg-deny/[0.08] px-4 py-2 text-[13px] text-soft">
          <span className="font-utility text-[12.5px] text-deny"><span aria-hidden className="inline-block animate-pulse">■</span> Emergency stop engaged</span>
          <span className="ml-3">Every new operation in this organization is denied with <code className="font-mono text-[0.9em]">PS_PAUSED_001</code>.</span>
          <Link href="/console/security" className="ml-3 text-mist underline decoration-deny/60 underline-offset-4">Review the emergency stop</Link>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[208px_minmax(0,1fr)]">
        <nav aria-label="Console" className="border-b border-line lg:sticky lg:top-12 lg:h-[calc(100dvh-3rem)] lg:border-b-0 lg:border-r">
          <ul className="flex gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:py-4">
            {NAV.map((n, i) => {
              const active = n.href === "/console" ? pathname === "/console" : pathname === n.href || pathname.startsWith(`${n.href}/`);
              return (
                <li key={n.href} className="shrink-0 animate-[c-fade_.45s_var(--ease-out-quint)_both]" style={{ animationDelay: `${80 + i * 40}ms` }}>
                  {n.group && <p className="label hidden px-3 pb-1 pt-3 !text-[9.5px] first:pt-0 lg:block">{n.group}</p>}
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={`group flex items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-[13.5px] transition-[background-color,color,transform] duration-300 hover:translate-x-0.5 ${
                      active ? "bg-raised text-mist shadow-[inset_0_1px_0_rgb(237_255_254/0.06)]" : "text-silver hover:bg-raised/60 hover:text-mist"
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <span aria-hidden className={`h-1.5 w-1.5 transition-all duration-500 ${active ? "scale-125 bg-aqua" : "bg-line-strong group-hover:bg-silver"}`} />
                      {n.label}
                    </span>
                    {n.href === "/console/approvals" && pending > 0 && (
                      <span key={pending} className="c-badge animate-[c-pop_.4s_var(--ease-out-quint)] rounded-[4px] border border-dashed border-review/60 px-1 font-mono text-[10px] text-review" aria-label={`${pending} pending`}>{pending}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {ready && (
            <div className="flex items-start justify-between gap-3 border-t border-line px-4 py-4">
              <div className="min-w-0 flex-1">
                <p className="label !text-[10px]">Organization</p>
                {session.me && session.me.organizations.length > 1 ? (
                  <select
                    aria-label="Organization"
                    value={session.org?.id ?? ""}
                    onChange={(e) => session.setOrgId(e.target.value)}
                    className="mt-1 w-full rounded-[4px] border border-reef bg-ink px-2 py-1 text-[12px] text-fg"
                  >
                    {session.me.organizations.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="mt-1 truncate text-[12.5px] text-soft">{org.data?.name ?? session.org?.name}</p>
                )}
                <p className="mt-1 font-utility text-[12px] text-dim">Role · {session.org?.role}</p>
              </div>
              <IconBtn label="Sign out" onClick={signOut} className="mt-3">
                <SignOutIcon size={15} />
              </IconBtn>
            </div>
          )}
        </nav>

        <main id="console-main" className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
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
                <span className={`font-utility text-[12px] ${live ? "text-review" : "text-aqua"}`}>{live ? "● Mainnet · real funds · pre-release · " : "● Testnet · pre-release · "}</span>
                PALISEC records and enforces each authorization decision. Agents with a PALISEC smart account are enforced on chain: PALISEC
                co-signs only what it allowed. An agent that sends from a plain key is only as safe as its own code.{" "}
                <Link href="/security" className="text-mist underline decoration-line-strong underline-offset-4 hover:text-aqua">What this protects</Link>
              </p>
              {children}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

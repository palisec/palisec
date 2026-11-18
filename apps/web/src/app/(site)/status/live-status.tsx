"use client";

import { useCallback, useEffect, useState } from "react";
import { serviceState, type HealthCheck, type Overall, type ServiceState } from "@/lib/health-status";

interface Health {
  status: Overall;
  checked_at?: string;
  components: Record<string, string>;
  checks?: HealthCheck[];
  schema_migration: string | null;
}

interface Service {
  name: string;
  note: string;
  /** Health checks this service depends on. Empty with `unchecked` for services that have no check yet. */
  ids: string[];
  unchecked?: boolean;
  roadmap?: boolean;
  mainnet?: boolean;
}

const SERVICES: Service[] = [
  { name: "Authorization API", note: "Decisions on mainnet 4663 and testnet 46630", ids: ["database", "auth", "policy_engine"] },
  { name: "Policy engine", note: "Rust (WebAssembly) and the reference evaluator must agree, or the request is denied", ids: ["policy_engine"] },
  { name: "Console and sign-in", note: "Wallet sign-in, agents, policies, approvals, audit", ids: ["database", "auth"] },
  { name: "Smart-account execution · mainnet", note: "Co-signer and bundler (Safe 4337 module, EntryPoint v0.7)", ids: ["mainnet_cosigner", "mainnet_bundler"], mainnet: true },
  { name: "Smart-account execution · testnet", note: "Co-signer and bundler on chain 46630", ids: ["testnet_cosigner", "testnet_bundler"] },
  { name: "PALISEC Agent", note: "Model key configured; answers are not probed", ids: ["agent_model"] },
  { name: "Webhooks and security events", note: "Signing key configured; deliveries are not probed", ids: ["webhooks"] },
  { name: "MCP server", note: "Streamable HTTP at /api/mcp, on the same authorization path", ids: [], unchecked: true },
  { name: "Signing enclave", note: "AWS Nitro, specified", ids: [], roadmap: true },
  { name: "Telemetry ingestion", note: "", ids: [], roadmap: true },
];

const BADGE: Record<ServiceState, { text: string; cls: string }> = {
  operational: { text: "● OPERATIONAL", cls: "text-allow" },
  not_running: { text: "✕ NOT RUNNING", cls: "text-deny" },
  unknown: { text: "? UNKNOWN", cls: "text-review" },
  unchecked: { text: "◐ DEPLOYED · UNCHECKED", cls: "text-silver" },
  roadmap: { text: "○ ROADMAP", cls: "text-dim" },
};

const HEADLINE: Record<Overall | "unknown" | "checking", { text: string; cls: string }> = {
  checking: { text: "Checking every service…", cls: "text-silver" },
  ok: { text: "All checked services are operational.", cls: "text-allow" },
  degraded: { text: "Some services are not running. Decisions still work.", cls: "text-review" },
  down: { text: "Authorization is down. Decisions are refused until it is back.", cls: "text-deny" },
  unknown: { text: "Status unknown: the health check could not be reached.", cls: "text-review" },
};

const utc = (iso: string) => `${iso.replace("T", " ").slice(0, 19)} UTC`;

function stateFor(s: Service, h: Health | null): { state: ServiceState; reason: string | null } {
  if (s.roadmap) return { state: "roadmap", reason: null };
  if (s.unchecked) return { state: "unchecked", reason: null };
  if (s.mainnet && h?.components.mainnet === "switched_off") return { state: "not_running", reason: "Mainnet is switched off by the operator." };
  return serviceState(h?.checks ?? null, s.ids);
}

/** The live state of every service, from GET /api/v1/health, checked on load and on request. */
export function LiveStatus() {
  const [h, setH] = useState<Health | null>(null);
  const [phase, setPhase] = useState<"checking" | "done" | "unreachable">("checking");
  const [at, setAt] = useState<string | null>(null);

  const check = useCallback(async () => {
    setPhase("checking");
    try {
      // 503 still carries the full report: degraded and down are answers, not failures to answer.
      const res = await fetch("/api/v1/health", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const body = (await res.json()) as Health;
      if (!body?.checks || !body.status) throw new Error("unexpected body");
      setH(body);
      setAt(body.checked_at ?? new Date().toISOString());
      setPhase("done");
    } catch {
      setH(null);
      setAt(new Date().toISOString());
      setPhase("unreachable");
    }
  }, []);

  useEffect(() => {
    // The check is the page's purpose, so it runs once on load (no polling).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void check();
  }, [check]);

  const headline = HEADLINE[phase === "checking" ? "checking" : phase === "unreachable" ? "unknown" : h!.status];

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4" aria-live="polite">
        <div>
          <p className={`font-heading text-[clamp(22px,2.2vw,30px)] font-medium leading-tight ${headline.cls}`}>{headline.text}</p>
          <p className="mt-2 font-mono text-[12px] text-dim">
            {at ? `Last checked ${utc(at)}` : "Not checked yet"}
            {h?.schema_migration ? ` · schema ${h.schema_migration}` : ""}
          </p>
        </div>
        <button type="button" onClick={check} disabled={phase === "checking"} className="rounded-[6px] border border-line-strong px-4 py-2 text-sm text-fg hover:border-aqua/60 disabled:opacity-50">
          {phase === "checking" ? "Checking…" : "Check again"}
        </button>
      </div>
      <ul className="divide-y divide-line border-y border-line">
        {SERVICES.map((s) => {
          const { state, reason } = phase === "checking" && !s.roadmap && !s.unchecked ? { state: "unknown" as const, reason: null } : stateFor(s, h);
          const badge = phase === "checking" && state === "unknown" ? { text: "… CHECKING", cls: "text-dim" } : BADGE[state];
          return (
            <li key={s.name} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 py-4">
              <span className="min-w-0 flex-1">
                <span className="text-fg">{s.name}</span>
                {s.note && <span className="ml-3 text-sm text-muted">{s.note}</span>}
                {reason && state !== "operational" && <span className={`mt-1 block text-[13.5px] ${state === "not_running" ? "text-deny" : "text-silver"}`}>{reason}</span>}
              </span>
              <span className={`shrink-0 font-mono text-[11px] tracking-[0.08em] ${badge.cls}`}>{badge.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

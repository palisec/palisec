"use client";

import { formatUsd, type CheckResult, type Decision } from "@palisec/policy-schema";
import { useState, type ReactNode } from "react";
import { Codes } from "../../ui";
import { Notice, Pill, type Tone } from "../kit";
import { ApiError } from "./session";

export interface LiveOperation {
  operation_id: string;
  request_id: string;
  agent_id: string;
  decision: Decision;
  reason_code: string | null;
  policy_id: string | null;
  policy_version: number | null;
  state: string;
  authorization_id: string | null;
  expires_at: string | null;
  message: string;
  checks: CheckResult[];
  created_at: string;
  details: {
    chain_id: number;
    account: string;
    target: string;
    value_wei: string;
    selector: string | null;
    data: string;
    gas_limit: number | null;
    fee_estimate_wei: string | null;
    exposure_usd_micros: string;
    request_hash: string;
    agent_name: string;
    decided_by: string | null;
    decided_at: string | null;
  };
}

export const usd = (micros: string | number | null | undefined) => formatUsd(BigInt(micros ?? 0));

/** UTC, to the second: the console never shows ambiguous local times. */
export const utc = (iso: string | null | undefined) => (iso ? `${iso.replace("T", " ").slice(0, 19)} UTC` : "—");

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return `in ${fmt(-s)}`;
  return `${fmt(s)} ago`;
}
function fmt(s: number) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const STATE: Record<string, [Tone, string, string]> = {
  denied: ["deny", "■", "Denied"],
  authorized: ["allow", "→", "Authorized"],
  pending_approval: ["review", "◆", "Pending approval"],
  approved: ["allow", "✓", "Approved"],
  rejected: ["muted", "×", "Rejected"],
  cancelled: ["muted", "–", "Cancelled"],
  expired: ["muted", "–", "Approval expired"],
  authorization_expired: ["muted", "–", "Authorization expired"],
};

export function StatePill({ state }: { state: string }) {
  const [tone, glyph, text] = STATE[state] ?? ["muted", "·", state];
  return (
    <Pill key={state} tone={tone} className="animate-[c-pop_.4s_var(--ease-out-quint)]">
      <span aria-hidden className={state === "pending_approval" ? "animate-pulse" : ""}>{glyph}</span>
      {text}
    </Pill>
  );
}

const DECISION: Record<Decision, [Tone, string, string]> = {
  ALLOW: ["allow", "→", "Allow"],
  DENY: ["deny", "■", "Deny"],
  REQUIRES_HUMAN_SIGNATURE: ["review", "◆", "Review"],
};
export function DecisionPill({ decision }: { decision: Decision }) {
  const [tone, glyph, text] = DECISION[decision];
  return (
    <Pill tone={tone}>
      <span aria-hidden>{glyph}</span>
      {text}
    </Pill>
  );
}

export function LoadError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  return <Notice tone="deny">{`${error.code}: ${error.message}`}</Notice>;
}

export function Loading({ what }: { what: string }) {
  return <p className="px-4 py-6 text-center font-utility text-[12.5px] text-dim">Loading {what}…</p>;
}

/** Runs an API action and reports its outcome in a notice; returns the result or null. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "allow" | "deny"; text: string } | null>(null);
  async function run<T>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | null> {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      if (success) setNotice({ tone: "allow", text: typeof success === "function" ? success(r) : success });
      return r;
    } catch (e) {
      setNotice({ tone: "deny", text: e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : "Request failed" });
      return null;
    } finally {
      setBusy(false);
    }
  }
  const view: ReactNode = notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null;
  return { run, busy, notice: view, clear: () => setNotice(null) };
}

/** The evaluation sequence for one decision, in order. */
export function CheckList({ checks }: { checks: CheckResult[] }) {
  const glyph: Record<string, [string, string]> = {
    pass: ["→", "text-allow"],
    fail: ["■", "text-deny"],
    review: ["◆", "text-review"],
    skipped: ["·", "text-dim"],
  };
  return (
    <ol className="divide-y divide-line">
      {checks.map((c, i) => {
        const [g, cls] = glyph[c.status] ?? ["·", "text-dim"];
        return (
          <li key={`${c.id}-${i}`} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-2 py-2 text-[12.5px]">
            <span aria-hidden className={`font-mono ${cls}`}>{g}</span>
            <div className="min-w-0">
              <p className={c.status === "skipped" ? "text-muted" : "text-soft"}>
                {c.label} <span className="sr-only">({c.status})</span>
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted"><Codes text={c.detail} /></p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const thCls = "label border-b border-line-strong px-4 py-2 !text-[10px] font-normal";

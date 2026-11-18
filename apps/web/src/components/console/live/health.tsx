"use client";

import { useEffect, useState } from "react";
import { MAINNET, networkLabel } from "@/lib/networks";
import type { HealthCheck, Overall } from "@/lib/health-status";
import { Notice } from "../kit";
import { useConsoleSession } from "./session";

export interface HealthReport {
  status: Overall;
  checked_at?: string;
  components: Record<string, string>;
  checks: HealthCheck[];
}

/**
 * The live health report for the console. GET /api/v1/health answers 503 when degraded or down, and
 * that body is still the report, so this reads it whatever the status code. `null` until it answers;
 * `"unreachable"` when it cannot be reached. Refetches whenever the session changes (network, org).
 */
export function useHealth(enabled = true): HealthReport | null | "unreachable" {
  const { version } = useConsoleSession();
  const [h, setH] = useState<HealthReport | null | "unreachable">(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/v1/health", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((b: HealthReport) => live && setH(Array.isArray(b?.checks) ? b : "unreachable"))
      .catch(() => live && setH("unreachable"));
    return () => {
      live = false;
    };
  }, [enabled, version]);
  return h;
}

export const findCheck = (h: HealthReport | null | "unreachable", id: string) => (h && h !== "unreachable" ? h.checks.find((c) => c.id === id) ?? null : null);

/** Smart-account execution on one network: both its co-signer and its bundler must pass. */
export function executionState(h: HealthReport | null | "unreachable", chainId: number): { ok: boolean | null; reason: string | null } {
  if (h === null) return { ok: null, reason: null };
  if (h === "unreachable") return { ok: null, reason: "The health check could not be reached." };
  if (chainId === MAINNET && h.components.mainnet === "switched_off") return { ok: false, reason: "Mainnet is switched off by the operator." };
  const prefix = chainId === MAINNET ? "mainnet" : "testnet";
  const failing = [findCheck(h, `${prefix}_cosigner`), findCheck(h, `${prefix}_bundler`)].find((c) => c && !c.ok);
  if (failing) return { ok: false, reason: failing.reason };
  const present = findCheck(h, `${prefix}_bundler`) && findCheck(h, `${prefix}_cosigner`);
  return present ? { ok: true, reason: null } : { ok: null, reason: "No execution check reported." };
}

/** Shown on the dashboard and the Smart accounts page when execution is not running on the console's network. */
export function ExecutionDownNotice({ h, chainId }: { h: HealthReport | null | "unreachable"; chainId: number }) {
  const e = executionState(h, chainId);
  if (e.ok !== false) return null;
  return (
    <Notice tone="deny">
      {`Smart-account execution is currently not running on ${networkLabel(chainId)}. Decisions still work. ${e.reason ?? ""}`.trim()}
    </Notice>
  );
}

/**
 * How PALISEC decides whether it is healthy. Pure functions, shared by GET /api/v1/health, the
 * /status page and the console, and unit-tested.
 *
 * - "decisions" checks are what authorization needs (database, sign-in, policy engine). If one fails,
 *   decisions are refused (fail closed) and the overall status is "down".
 * - "execution" checks are what mainnet smart-account execution needs (co-signer, bundler). If one
 *   fails, decisions still work but transactions cannot be executed: "degraded".
 * - Non-critical checks (testnet execution, PALISEC Agent model, webhook signing) failing: "degraded".
 * Overall "ok" (HTTP 200) only when every check passes; "degraded" and "down" answer HTTP 503.
 */

export type Criticality = "decisions" | "execution" | "none";
export type Overall = "ok" | "degraded" | "down";

export interface HealthCheck {
  id: string;
  label: string;
  critical: Criticality;
  /** Whether it is set up at all (an environment variable present), reported apart from whether it works. */
  configured: boolean;
  /** Whether the live check passed. Config-only checks pass when configured, and say so in `verified`. */
  ok: boolean;
  /** true when a live call proved it works; false when only configuration was checked. */
  verified: boolean;
  /** The raw state, e.g. "ok", "reachable", "network_not_enabled_in_alchemy". */
  state: string;
  /** One line in plain words when it is not ok. */
  reason: string | null;
  /** Co-signers only: when PALISEC last co-signed a transaction that succeeded on chain (time only). */
  last_success_at?: string | null;
}

export function overallStatus(checks: Pick<HealthCheck, "critical" | "ok">[]): Overall {
  if (checks.some((c) => c.critical === "decisions" && !c.ok)) return "down";
  if (checks.some((c) => !c.ok)) return "degraded";
  return "ok";
}

export const httpStatusFor = (s: Overall): number => (s === "ok" ? 200 : 503);

const BUNDLER_REASON: Record<string, string> = {
  network_not_enabled_in_alchemy: "the network is not enabled in Alchemy",
  invalid_alchemy_key: "the Alchemy key was refused",
  unreachable: "the bundler did not answer",
  wrong_chain: "the bundler answers for a different network",
  entrypoint_missing: "the bundler does not support EntryPoint v0.7",
  not_configured: "no bundler is configured",
};

export function bundlerReason(state: string, network: string): string | null {
  if (state === "reachable") return null;
  return `${network} smart-account transactions can't be submitted: ${BUNDLER_REASON[state] ?? state.replace(/_/g, " ")}.`;
}

export function cosignerReason(state: string, network: string): string | null {
  if (state === "configured") return null;
  if (state === "same_as_testnet") return `${network} smart-account transactions can't be co-signed: the mainnet key equals the testnet key and is refused.`;
  return `${network} smart-account transactions can't be co-signed: the co-signer key is not set.`;
}

/** The user-facing state for one service built from one or more checks. */
export type ServiceState = "operational" | "not_running" | "unknown" | "roadmap" | "unchecked";

export function serviceState(checks: HealthCheck[] | null, ids: string[]): { state: ServiceState; reason: string | null } {
  if (!checks) return { state: "unknown", reason: "The health check could not be reached." };
  const mine = checks.filter((c) => ids.includes(c.id));
  if (mine.length === 0) return { state: "unknown", reason: "No check reported." };
  const failing = mine.find((c) => !c.ok);
  if (failing) return { state: "not_running", reason: failing.reason };
  if (mine.every((c) => !c.verified)) return { state: "unchecked", reason: null };
  return { state: "operational", reason: null };
}

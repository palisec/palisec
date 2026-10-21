import { REASON_CODES, RETRYABLE, type ReasonCode } from "./codes";
import type {
  CheckResult,
  Environment,
  EvaluationResult,
  Intent,
  LedgerState,
  Policy,
  Reservation,
} from "./types";
import { validatePolicy } from "./validate";

/**
 * Deterministic local evaluator (spec §5.2, §9.4).
 *
 * Same policy + intent + state + environment always yields the same result. It never
 * signs, never broadcasts, and never mutates its inputs: the caller receives
 * `next_state` and decides whether to keep it.
 *
 * This is the reference behaviour for the schema. The production evaluator runs the
 * same checks inside the protected signing boundary against authoritative state.
 */

const WINDOW_SECONDS = 3600;
const RESERVATION_TTL_SECONDS = 300;
const MAX_CALLDATA_BYTES = 65536;
const WEI_PER_ETH = 10n ** 18n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x([0-9a-fA-F]{2})*$/;
const UINT = /^(0|[1-9][0-9]{0,77})$/;

export const EMPTY_STATE: LedgerState = {
  reservations: [],
  seen_request_ids: [],
  calldata_seen: {},
  intent_seen: {},
};

/** 64-bit FNV-1a. A local fingerprint only; the production path uses keccak256. */
export function fingerprint(input: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return "0x" + h.toString(16).padStart(16, "0");
}

export function selectorOf(data: string): string | null {
  return data.length >= 10 ? data.slice(0, 10).toLowerCase() : null;
}

/** USD micros for an amount of wei, rounded up so limits are never under-counted. */
export function weiToUsdMicros(wei: bigint, priceMicros: bigint): bigint {
  const n = wei * priceMicros;
  return n === 0n ? 0n : (n + WEI_PER_ETH - 1n) / WEI_PER_ETH;
}

const LIVE_CHECKS: Omit<CheckResult, "status" | "detail">[] = [
  { id: "simulate", label: "Execution simulation against chain state", enforcement: "live" },
  { id: "bind", label: "Authorization bound to operation hash, chain, policy version, expiry", enforcement: "live" },
  { id: "sign", label: "Signature from the protected signing path", enforcement: "live" },
  { id: "validate_onchain", label: "Smart-account validation of the Palisec signature", enforcement: "live" },
  { id: "submit", label: "Bundler submission and receipt reconciliation", enforcement: "live" },
];

export function evaluate(
  policy: Policy | null,
  intent: Intent,
  state: LedgerState,
  env: Environment,
): EvaluationResult {
  const checks: CheckResult[] = [];
  let failed: { code: ReasonCode; message: string } | null = null;
  let review: { code: ReasonCode; message: string } | null = null;

  const run = (
    id: string,
    label: string,
    fn: () => { status: "pass" | "fail" | "review"; detail: string; code?: ReasonCode },
  ) => {
    if (failed) {
      checks.push({ id, label, status: "skipped", detail: "Not evaluated: an earlier check denied the request.", enforcement: "local" });
      return;
    }
    const r = fn();
    checks.push({ id, label, status: r.status, detail: r.detail, enforcement: "local" });
    if (r.status === "fail") failed = { code: r.code!, message: r.detail };
    if (r.status === "review" && !review) review = { code: r.code!, message: r.detail };
  };

  // Expire stale reservations before reading budget state.
  const reservations: Reservation[] = state.reservations.map((r) =>
    r.state === "reserved" && r.expires_at <= env.now ? { ...r, state: "released" } : r,
  );

  let usd = 0n;
  let fee = 0n;
  const value = UINT.test(intent.value_wei) ? BigInt(intent.value_wei) : 0n;
  const selector = selectorOf(intent.data);

  run("policy", "Active, valid policy", () => {
    if (!policy) return { status: "fail", code: "RW_POLICY_001", detail: "No policy is configured. A missing policy is never treated as allow-all." };
    const errs = validatePolicy(policy);
    if (errs.length) return { status: "fail", code: "RW_POLICY_001", detail: `Policy failed schema validation: ${errs[0]!.path} ${errs[0]!.message}.` };
    if (policy.status !== "active") return { status: "fail", code: "RW_POLICY_001", detail: `Policy status is "${policy.status}", not active.` };
    return { status: "pass", detail: `${policy.policy_id} v${policy.version} is active.` };
  });

  run("schema", "Request schema", () => {
    const bad =
      !ADDRESS.test(intent.from) ? "from" :
      !ADDRESS.test(intent.to) ? "to" :
      !UINT.test(intent.value_wei) ? "value_wei" :
      !HEX.test(intent.data) ? "data" :
      (intent.data.length - 2) / 2 > MAX_CALLDATA_BYTES ? "data (too long)" :
      !intent.request_id ? "request_id" : null;
    if (bad) return { status: "fail", code: "RW_REQUEST_001", detail: `Invalid field: ${bad}.` };
    return { status: "pass", detail: "All fields well-formed and within size bounds." };
  });

  run("replay", "Request identity, deadline, replay", () => {
    if (state.seen_request_ids.includes(intent.request_id))
      return { status: "fail", code: "RW_REPLAY_001", detail: `request_id ${intent.request_id} was already evaluated.` };
    if (intent.deadline <= env.now)
      return { status: "fail", code: "RW_REPLAY_001", detail: `Deadline ${intent.deadline} has passed (now ${env.now}).` };
    return { status: "pass", detail: `New request; ${intent.deadline - env.now}s until deadline.` };
  });

  run("active", "Emergency stop and agent status", () => {
    if (env.emergency_stop) return { status: "fail", code: "RW_PAUSED_001", detail: "Global emergency stop is active. All new protected executions are denied." };
    if (env.paused_agents.includes(intent.agent_id)) return { status: "fail", code: "RW_PAUSED_001", detail: `Agent ${intent.agent_id} is paused.` };
    return { status: "pass", detail: "No emergency stop; agent is active." };
  });

  run("chain", "Chain and account binding", () => {
    if (intent.chain_id !== policy!.account.chain_id)
      return { status: "fail", code: "RW_TARGET_001", detail: `Chain ${intent.chain_id} does not match policy chain ${policy!.account.chain_id}.` };
    if (intent.from.toLowerCase() !== policy!.account.address.toLowerCase())
      return { status: "fail", code: "RW_POLICY_001", detail: "Sender is not the account this policy protects." };
    return { status: "pass", detail: `Chain ${intent.chain_id}; account matches.` };
  });

  run("denylist", "Explicit deny rules", () => {
    const hit = policy!.contracts.denylist.some((a) => a.toLowerCase() === intent.to.toLowerCase());
    if (hit) return { status: "fail", code: "RW_POLICY_002", detail: "Target is on the explicit denylist. Deny overrides allow." };
    return { status: "pass", detail: "No deny rule matched." };
  });

  const entry = policy?.contracts.allowlist.find((e) => e.address.toLowerCase() === intent.to.toLowerCase());

  run("target", "Target contract allowlist", () => {
    if (!entry) return { status: "fail", code: "RW_TARGET_001", detail: "Target is not on the allowlist; default is deny." };
    if (entry.require_verified_code && env.verified_code[intent.to.toLowerCase()] !== true)
      return { status: "fail", code: "RW_TARGET_001", detail: "Target requires verified code, and verification is missing or failed." };
    return { status: "pass", detail: entry.require_verified_code ? "Allowlisted; code verified." : "Allowlisted." };
  });

  run("method", "Function selector", () => {
    if (!selector) return { status: "pass", detail: "Native transfer (no calldata)." };
    if (entry!.selectors.includes(selector as `0x${string}`)) return { status: "pass", detail: `Selector ${selector} is allowed.` };
    if (policy!.human_approval.require_for_unknown_methods)
      return { status: "review", code: "RW_HUMAN_001", detail: `Selector ${selector} is not allowlisted; policy routes unknown methods to human review.` };
    return { status: "fail", code: "RW_METHOD_001", detail: `Selector ${selector} is not allowed.` };
  });

  run("value", "Per-transaction value limit", () => {
    const max = BigInt(policy!.limits.max_transaction_value_wei);
    if (value > max) return { status: "fail", code: "RW_BUDGET_001", detail: `Value ${value} wei exceeds the per-transaction limit of ${max} wei.` };
    return { status: "pass", detail: `${value} wei ≤ ${max} wei.` };
  });

  run("fee", "Fee estimate", () => {
    if (env.fee_estimate_wei === null || !UINT.test(env.fee_estimate_wei))
      return { status: "fail", code: "RW_FEE_001", detail: "Fee estimate unavailable. An unknown fee is never treated as zero." };
    fee = BigInt(env.fee_estimate_wei);
    const max = BigInt(policy!.limits.max_gas_cost_wei);
    if (fee > max) return { status: "fail", code: "RW_BUDGET_001", detail: `Estimated fee ${fee} wei exceeds the gas limit of ${max} wei.` };
    return { status: "pass", detail: `Estimated fee ${fee} wei ≤ ${max} wei.` };
  });

  run("price", "Price freshness", () => {
    if (!env.eth_usd) return { status: "fail", code: "RW_STATE_001", detail: "No price available. USD limits cannot be enforced, so the request fails closed." };
    const age = env.now - env.eth_usd.observed_at;
    if (age > policy!.limits.max_price_age_seconds)
      return { status: "fail", code: "RW_STATE_001", detail: `Price is ${age}s old; maximum is ${policy!.limits.max_price_age_seconds}s.` };
    usd = weiToUsdMicros(value + fee, BigInt(env.eth_usd.price_micros));
    return { status: "pass", detail: `Price is ${age}s old. Exposure: ${formatUsd(usd)} (value + fee).` };
  });

  run("budget", "Rolling hourly budget (atomic reservation)", () => {
    const since = env.now - WINDOW_SECONDS;
    const used = reservations
      .filter((r) => r.state !== "released" && r.created_at > since)
      .reduce((s, r) => s + BigInt(r.amount_usd_micros), 0n);
    const max = BigInt(policy!.limits.hourly_budget_usd_micros);
    if (used + usd > max)
      return { status: "fail", code: "RW_BUDGET_001", detail: `${formatUsd(used)} used + ${formatUsd(usd)} requested exceeds the ${formatUsd(max)} hourly budget.` };
    return { status: "pass", detail: `${formatUsd(used + usd)} of ${formatUsd(max)} after this reservation.` };
  });

  run("pending", "Pending operation limit", () => {
    const open = reservations.filter((r) => r.state === "reserved" || r.state === "pending_approval").length;
    const max = policy!.limits.max_pending_operations;
    if (open >= max) return { status: "fail", code: "RW_RATE_001", detail: `${open} operations pending; limit is ${max}.` };
    return { status: "pass", detail: `${open} of ${max} pending slots in use.` };
  });

  const calldataKey = fingerprint(`${intent.to.toLowerCase()}|${intent.data.toLowerCase()}`);
  const intentKey = fingerprint(`${intent.agent_id}|${intent.to.toLowerCase()}|${selector ?? "native"}|${intent.value_wei}`);

  run("loop", "Repeated calldata and intent", () => {
    const c = state.calldata_seen[calldataKey];
    const cd = policy!.cooldowns.identical_calldata_seconds;
    if (c !== undefined && env.now - c < cd)
      return { status: "fail", code: "RW_LOOP_001", detail: `Identical calldata seen ${env.now - c}s ago; cooldown is ${cd}s.` };
    const i = state.intent_seen[intentKey];
    const id = policy!.cooldowns.identical_intent_seconds;
    if (i !== undefined && env.now - i < id)
      return { status: "fail", code: "RW_LOOP_001", detail: `Equivalent intent seen ${env.now - i}s ago; cooldown is ${id}s.` };
    return { status: "pass", detail: "No repeat within the cooldown windows." };
  });

  run("human", "Human approval threshold", () => {
    const t = BigInt(policy!.human_approval.usd_threshold_micros);
    if (usd >= t) return { status: "review", code: "RW_HUMAN_001", detail: `${formatUsd(usd)} meets the ${formatUsd(t)} approval threshold.` };
    return { status: "pass", detail: `${formatUsd(usd)} is below the ${formatUsd(t)} approval threshold.` };
  });

  for (const c of LIVE_CHECKS)
    checks.push({ ...c, status: "skipped", detail: "Requires a live protected account. The simulator never signs or broadcasts." });

  // Request IDs are consumed once the request is well-formed, whatever the decision.
  const schemaOk = checks.find((c) => c.id === "schema")?.status === "pass";
  const seen = schemaOk && !state.seen_request_ids.includes(intent.request_id)
    ? [...state.seen_request_ids, intent.request_id]
    : state.seen_request_ids;

  const f = failed as { code: ReasonCode; message: string } | null;
  const rv = review as { code: ReasonCode; message: string } | null;

  if (f) {
    return {
      request_id: intent.request_id,
      decision: "DENY",
      reason_code: f.code,
      policy_id: policy?.policy_id ?? null,
      policy_version: policy?.version ?? null,
      authorization_id: null,
      transaction_hash: null,
      retryable: RETRYABLE[f.code],
      message: f.message,
      checks,
      next_state: { ...state, reservations, seen_request_ids: seen },
    };
  }

  const p = policy!;
  const pending = rv !== null;
  const reservation: Reservation = {
    reservation_id: "rw_res_" + fingerprint(`${intent.request_id}|${p.version}`).slice(2),
    request_id: intent.request_id,
    agent_id: intent.agent_id,
    policy_version: p.version,
    amount_usd_micros: usd.toString(),
    created_at: env.now,
    expires_at: env.now + RESERVATION_TTL_SECONDS,
    state: pending ? "pending_approval" : "reserved",
  };

  return {
    request_id: intent.request_id,
    decision: pending ? "REQUIRES_HUMAN_SIGNATURE" : "ALLOW",
    reason_code: pending ? rv.code : null,
    policy_id: p.policy_id,
    policy_version: p.version,
    authorization_id: pending ? null : "rw_auth_" + fingerprint(`${intent.request_id}|${p.policy_id}|${p.version}`).slice(2),
    transaction_hash: null,
    retryable: false,
    message: pending
      ? `${rv.message} Nothing is signed until an approver signs this exact operation.`
      : "Authorized. Budget reserved; signing and submission happen only on the protected path.",
    checks,
    next_state: {
      reservations: [...reservations, reservation],
      seen_request_ids: seen,
      calldata_seen: { ...state.calldata_seen, [calldataKey]: env.now },
      intent_seen: { ...state.intent_seen, [intentKey]: env.now },
    },
  };
}

export function formatUsd(micros: bigint): string {
  const neg = micros < 0n;
  const abs = neg ? -micros : micros;
  const dollars = abs / 1_000_000n;
  const cents = (abs % 1_000_000n) / 10_000n;
  return `${neg ? "-" : ""}$${dollars.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export function describe(code: ReasonCode): string {
  return REASON_CODES[code];
}

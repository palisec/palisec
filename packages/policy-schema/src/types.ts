import type { ReasonCode } from "./codes";

/** Decimal integer encoded as a string, e.g. wei or USD micros. Never a float. */
export type UintString = string;
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export const SCHEMA_VERSION = "1.0" as const;

export interface AllowlistEntry {
  address: Address;
  /** 4-byte function selectors. Empty array means no methods are allowed. */
  selectors: Hex[];
  require_verified_code: boolean;
}

export interface Policy {
  schema_version: typeof SCHEMA_VERSION;
  policy_id: string;
  /** Monotonic version assigned on activation. */
  version: number;
  account: { chain_id: number; address: Address };
  status: "draft" | "active" | "disabled";
  limits: {
    max_transaction_value_wei: UintString;
    max_gas_cost_wei: UintString;
    hourly_budget_usd_micros: UintString;
    max_pending_operations: number;
    /** USD limits are only enforceable with a fresh price. Older prices fail closed. */
    max_price_age_seconds: number;
  };
  cooldowns: {
    identical_calldata_seconds: number;
    identical_intent_seconds: number;
  };
  contracts: {
    default: "deny";
    allowlist: AllowlistEntry[];
    denylist: Address[];
  };
  human_approval: {
    usd_threshold_micros: UintString;
    require_for_unknown_methods: boolean;
  };
  failure_mode: "closed";
}

/** A proposed action from an agent. Typed intent, never free text. */
export interface Intent {
  request_id: string;
  agent_id: string;
  chain_id: number;
  from: Address;
  to: Address;
  value_wei: UintString;
  data: Hex;
  /** Unix seconds. Requests past their deadline are rejected. */
  deadline: number;
}

/** Inputs that come from outside the request. Each may be unavailable. */
export interface Environment {
  /** Unix seconds. Passed in explicitly so evaluation is deterministic. */
  now: number;
  fee_estimate_wei: UintString | null;
  eth_usd: { price_micros: UintString; observed_at: number } | null;
  /** Code verification result per address, as reported by the chain worker. */
  verified_code: Record<string, boolean>;
  emergency_stop: boolean;
  paused_agents: string[];
}

export type ReservationState = "reserved" | "pending_approval" | "released" | "finalized";

export interface Reservation {
  reservation_id: string;
  request_id: string;
  agent_id: string;
  policy_version: number;
  amount_usd_micros: UintString;
  created_at: number;
  expires_at: number;
  state: ReservationState;
}

/** Authoritative state snapshot. Evaluation never mutates it; it returns the next snapshot. */
export interface LedgerState {
  reservations: Reservation[];
  seen_request_ids: string[];
  /** fingerprint -> last seen unix seconds */
  calldata_seen: Record<string, number>;
  intent_seen: Record<string, number>;
}

export type Decision = "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";

export type CheckStatus = "pass" | "fail" | "review" | "skipped";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** "local" checks run in the simulator. "live" checks need a protected account. */
  enforcement: "local" | "live";
}

export interface EvaluationResult {
  request_id: string;
  decision: Decision;
  reason_code: ReasonCode | null;
  policy_id: string | null;
  policy_version: number | null;
  authorization_id: string | null;
  /** Always null here: the simulator never signs or broadcasts. */
  transaction_hash: null;
  retryable: boolean;
  message: string;
  checks: CheckResult[];
  next_state: LedgerState;
}

import type { ReasonCode } from "./codes";

/** Decimal integer encoded as a string, e.g. wei or USD micros. Never a float. */
export type UintString = string;
export type Address = `0x${string}`;
export type Hex = `0x${string}`;

/** The version new policies are written in. 1.0 documents stay valid; 1.1 adds `asset_safety`. */
export const SCHEMA_VERSION = "1.1" as const;
export const SCHEMA_VERSIONS = ["1.0", "1.1"] as const;
export type SchemaVersion = (typeof SCHEMA_VERSIONS)[number];

/** Native ETH in balance changes and declared intent (the common 0xEeee… convention), lowercase. */
export const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" as const;

/**
 * Schema 1.1: what the transaction actually does to the account's assets, checked against a
 * simulation on current chain state before PALISEC allows (and co-signs) it.
 */
export interface AssetSafety {
  enabled: boolean;
  /** Highest acceptable transfer tax on a received token (buy or sell leg), basis points. */
  max_transfer_tax_bps: number;
  /** How far below the declared (quoted) amount a received token may come in, basis points. */
  max_slippage_bps: number;
  /** Tokens received must survive a simulated sell leg (sent back to the pool they came from). */
  require_sell_simulation: boolean;
  /** Approvals must be for the declared amount, or to a contract on the allowlist. */
  block_unlimited_approvals: boolean;
  /** No usable simulation: deny (default) or hold for a human. Never allow. */
  on_simulation_unavailable: "deny" | "review";
  /** A simulation older than this counts as unavailable. */
  max_simulation_age_seconds: number;
}

export interface AssetAmount {
  /** ERC-20 address, or NATIVE_TOKEN for ETH. */
  token: Address;
  amount: UintString;
}

/** What the agent says the operation spends (at most) and receives (quoted). Optional. */
export interface AssetIntent {
  spend: AssetAmount[];
  receive: AssetAmount[];
}

/** One simulation of the exact operation from the account, produced before evaluation. */
export interface AssetSimulation {
  block_number: number;
  /** Unix seconds of the simulated block. */
  observed_at: number;
  reverted: boolean;
  /** Net amounts leaving and entering the account, per token (gas excluded). */
  outflows: AssetAmount[];
  inflows: AssetAmount[];
  /** Allowances the account granted during the operation. */
  approvals: { token: Address; spender: Address; amount: UintString }[];
  /** Sell leg for received tokens; null when nothing was received or no leg could be built. */
  sell: { reverted: boolean } | null;
  /** Highest transfer tax seen on the buy or sell leg, basis points; null if nothing was received. */
  tax_bps: number | null;
  /** Value lost buying and immediately selling back, basis points; null when no route quotes it. */
  round_trip_loss_bps: number | null;
}

export interface AllowlistEntry {
  address: Address;
  /** 4-byte function selectors. Empty array means no methods are allowed. */
  selectors: Hex[];
  require_verified_code: boolean;
}

export interface Policy {
  schema_version: SchemaVersion;
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
  /** Schema 1.1 only. Absent means off. */
  asset_safety?: AssetSafety;
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
  /** Declared asset movement, checked against the simulation when asset safety is on. */
  asset_intent?: AssetIntent;
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
  /** Simulation of this exact operation; absent or null means unavailable (fails closed). */
  asset_simulation?: AssetSimulation | null;
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

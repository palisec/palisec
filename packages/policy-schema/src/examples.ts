import type { Environment, Intent, Policy } from "./types";

/**
 * Illustrative data for the local simulator and documentation.
 * These addresses and limits are not live deployments or recommended production limits.
 */

export const EXAMPLE_ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
export const EXAMPLE_TOKEN = "0x2222222222222222222222222222222222222222" as const;
export const EXAMPLE_ROUTER = "0x3333333333333333333333333333333333333333" as const;
export const EXAMPLE_UNKNOWN = "0x4444444444444444444444444444444444444444" as const;
export const EXAMPLE_DENIED = "0x5555555555555555555555555555555555555555" as const;
export const EXAMPLE_RECIPIENT = "000000000000000000000000abcdefabcdefabcdefabcdefabcdefabcdefabcd";

export const SELECTORS = {
  transfer: "0xa9059cbb",
  approve: "0x095ea7b3",
  swapExactTokensForTokens: "0x38ed1739",
} as const;

export const EXAMPLE_POLICY: Policy = {
  schema_version: "1.0",
  policy_id: "policy_trading_001",
  version: 7,
  account: { chain_id: 4663, address: EXAMPLE_ACCOUNT },
  status: "active",
  limits: {
    max_transaction_value_wei: "100000000000000000",
    max_gas_cost_wei: "5000000000000000",
    hourly_budget_usd_micros: "500000000",
    max_pending_operations: 3,
    max_price_age_seconds: 60,
  },
  cooldowns: {
    identical_calldata_seconds: 60,
    identical_intent_seconds: 15,
  },
  contracts: {
    default: "deny",
    allowlist: [
      { address: EXAMPLE_TOKEN, selectors: [SELECTORS.transfer], require_verified_code: true },
      { address: EXAMPLE_ROUTER, selectors: [SELECTORS.swapExactTokensForTokens], require_verified_code: true },
    ],
    denylist: [EXAMPLE_DENIED],
  },
  human_approval: {
    usd_threshold_micros: "150000000",
    require_for_unknown_methods: true,
  },
  failure_mode: "closed",
};

/** Simulated clock origin: 2026-01-01T00:00:00Z. */
export const SIM_EPOCH = 1767225600;

export const EXAMPLE_ENV: Environment = {
  now: SIM_EPOCH,
  fee_estimate_wei: "120000000000000",
  eth_usd: { price_micros: "3200000000", observed_at: SIM_EPOCH },
  verified_code: { [EXAMPLE_TOKEN]: true, [EXAMPLE_ROUTER]: true },
  emergency_stop: false,
  paused_agents: [],
};

const transferData = (amountHex: string) =>
  `${SELECTORS.transfer}${EXAMPLE_RECIPIENT}${amountHex.padStart(64, "0")}` as `0x${string}`;

const word = (v: bigint | string) => (typeof v === "string" ? v.replace(/^0x/, "").padStart(64, "0") : v.toString(16).padStart(64, "0"));

/** swapExactTokensForTokens(amountIn, amountOutMin, path[token, WETH], to, deadline), fully ABI-encoded. */
const swapData = (amountIn: bigint, amountOutMin: bigint) =>
  `${SELECTORS.swapExactTokensForTokens}${[
    word(amountIn),
    word(amountOutMin),
    word(0xa0n), // offset of the dynamic path array
    word(EXAMPLE_ACCOUNT),
    word(BigInt(SIM_EPOCH + 600)),
    word(2n),
    word(EXAMPLE_TOKEN),
    word("0x6666666666666666666666666666666666666666"),
  ].join("")}` as `0x${string}`;

export interface Scenario {
  id: string;
  label: string;
  summary: string;
  intent: Omit<Intent, "request_id" | "deadline">;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "token-transfer",
    label: "Token transfer",
    summary: "transfer() on an allowlisted token, no ETH value.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_TOKEN, value_wei: "0", data: transferData("2540be400") },
  },
  {
    id: "swap",
    label: "Router swap · 0.04 ETH",
    summary: "Allowlisted swap selector carrying 0.04 ETH.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_ROUTER, value_wei: "40000000000000000", data: swapData(128_000_000n, 126_000_000n) },
  },
  {
    id: "large-swap",
    label: "Router swap · 0.08 ETH",
    summary: "Within the value limit, above the human-approval threshold.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_ROUTER, value_wei: "80000000000000000", data: swapData(256_000_000n, 252_000_000n) },
  },
  {
    id: "over-limit",
    label: "Swap · 0.5 ETH",
    summary: "Same swap at ten times the per-transaction limit.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_ROUTER, value_wei: "500000000000000000", data: swapData(1_600_000_000n, 1_580_000_000n) },
  },
  {
    id: "unknown-method",
    label: "approve() on token",
    summary: "A selector the policy does not list.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_TOKEN, value_wei: "0", data: `${SELECTORS.approve}${EXAMPLE_RECIPIENT}${"f".repeat(64)}` },
  },
  {
    id: "unknown-target",
    label: "Unlisted contract",
    summary: "A call to a contract that is not on the allowlist.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_UNKNOWN, value_wei: "10000000000000000", data: "0x" },
  },
  {
    id: "denied-target",
    label: "Denylisted contract",
    summary: "A target named in an explicit deny rule.",
    intent: { agent_id: "agent_rebalancer_01", chain_id: 4663, from: EXAMPLE_ACCOUNT, to: EXAMPLE_DENIED, value_wei: "0", data: transferData("1") },
  },
];

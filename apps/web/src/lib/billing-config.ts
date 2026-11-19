/**
 * Phase 5 billing and token settings (approved values, 2026-11-19). Public: no secrets here.
 * The server reads the environment overrides in `server/billing.ts`; pages show these values.
 */
export const BILLING = {
  /** Mainnet decisions included per organization per UTC month. Testnet and dry runs are never metered. */
  freeDecisionsPerMonth: 1_000,
  /** USD (6 decimals) for 1,000 credits; one credit is one mainnet decision. */
  priceUsdE6PerThousand: 5_000_000,
  /** Discount when paying in $PALISEC, basis points. */
  palisecDiscountBps: 2_000,
  /** Caps on the $PALISEC path, USD (6 decimals). Recomputed after the token graduates. */
  maxPalisecUsdE6PerPurchase: 10_000_000,
  maxPalisecUsdE6PerAccountPerDay: 25_000_000,
  /** Cap on one USDG or ETH purchase, USD (6 decimals). */
  maxUsdE6PerPurchase: 1_000_000_000,
  /** Price guard for $PALISEC: TWAP window, deviation and minimum pool value. */
  twapWindowSeconds: 1_800,
  maxDeviationBps: 1_000,
  minPoolUsdE6: 10_000_000_000,
  /** Warnings at these shares of the free allowance (and when credits run low). */
  warnAt: [0.8, 0.95],
  /** Holding at least this many $PALISEC (18 decimals) in an owner wallet unlocks Pro. */
  proHoldingTokens: 5_000_000n * 10n ** 18n,
  proCheckSeconds: 600,
  /** Credit packs offered in the console. */
  packs: [1_000, 5_000, 20_000],
} as const;

export interface PlanLimits {
  agents: number;
  policies: number;
  auditDays: number;
  apiRequestsPerMinute: number;
  agentRequestsPerDay: number;
}

/** Normal limits sit well above current use; Pro multiplies them (approved: 5x, 1 year, 5x, 10x). */
export const LIMITS: { normal: PlanLimits; pro: PlanLimits } = {
  normal: { agents: 10, policies: 10, auditDays: 90, apiRequestsPerMinute: 120, agentRequestsPerDay: 50 },
  pro: { agents: 50, policies: 50, auditDays: 365, apiRequestsPerMinute: 600, agentRequestsPerDay: 500 },
};

/** Robinhood Chain mainnet facts used by billing (verified on chain 2026-11-18/19). */
export const TOKEN = {
  chainId: 4663,
  palisec: "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  ethUsdFeed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
  burnAddress: "0x000000000000000000000000000000000000dEaD",
  explorer: "https://robinhoodchain.blockscout.com",
} as const;

export const usdE6 = (n: number | bigint) => `$${(Number(n) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

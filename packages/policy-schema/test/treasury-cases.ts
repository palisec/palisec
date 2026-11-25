/**
 * Named treasury guard cases (schema 1.6). The reference tests check each expected decision, and the
 * engine parity tests run the same cases through the Rust engine, which must return the same result.
 */
import { EMPTY_STATE, type AssetSimulation, type Environment, type Intent, type LedgerState, type Policy, type TreasuryGuard, type TreasuryWindow } from "../src";
import { ACCOUNT, MULTICALL, NOW, RECIPIENT, ROUTER, UNKNOWN, env as spendEnv, intent, sim, spendPolicy } from "./spend-cases";

export const PROJECT = "0x1b4d04c8a67bf98bdf791ef928482bcb225d71ab";
export const CURVE = "0x6666666666666666666666666666666666666666";
export const VESTING = "0x5555555555555555555555555555555555555555";
export const LP = "0xabababababababababababababababababababab";
export const INSIDER = RECIPIENT;

const SWAP = "0x04e45aaf";
const MULTI = "0xac9650d8";
const tokens = (n: number) => (BigInt(n) * 10n ** 18n).toString();

export const GUARD: TreasuryGuard = {
  enabled: true,
  project_token: PROJECT as Move["token"],
  allowed_destinations: [VESTING as Move["to"]],
  allowed_sell_venues: [CURVE as Move["to"], ROUTER as Move["to"]],
  daily_sell_cap: { amount: tokens(2000), pct_of_holdings_bps: null },
  approvals: "exact_to_venues",
  protect_liquidity: true,
  lp_tokens: [LP as Move["to"]],
  locked_until: NOW + 30 * 86400,
};

export function guardPolicy(g: Partial<TreasuryGuard> = {}): Policy {
  const p = spendPolicy(null);
  p.schema_version = "1.6";
  p.contracts.allowlist.push({ address: PROJECT as Move["to"], selectors: ["0xa9059cbb", "0x095ea7b3"], require_verified_code: false });
  p.contracts.allowlist.push({ address: CURVE as Move["to"], selectors: ["0xd96a094a"], require_verified_code: false });
  p.contracts.allowlist.push({ address: LP as Move["to"], selectors: ["0xa9059cbb", "0x095ea7b3"], require_verified_code: false });
  p.treasury_guard = JSON.parse(JSON.stringify({ ...GUARD, ...g }));
  return p;
}

export function window(sold: number, holdings = 10000, over: Partial<TreasuryWindow> = {}): TreasuryWindow {
  return { observed_at: NOW - 4, sold_24h: tokens(sold), holdings_at_window_start: tokens(holdings), ...over };
}

export function tenv(simulation: AssetSimulation | null, w: TreasuryWindow | null = window(0)): Environment {
  return { ...spendEnv(simulation, null), treasury: w };
}

type Move = { token: `0x${string}`; to: `0x${string}`; amount: string };
const out = (to: string, n: number, token: string = PROJECT): Move => ({ token: token as Move["token"], to: to as Move["to"], amount: tokens(n) });
const moveSim = (transfers: Move[], over: Partial<AssetSimulation> = {}) =>
  sim({ outflows: transfers.map((t) => ({ token: t.token, amount: t.amount })), transfers_out: transfers, ...over });

export interface TreasuryCase {
  name: string;
  policy: Policy;
  intent: Intent;
  state: LedgerState;
  env: Environment;
  decision: "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE";
  code: string | null;
}

const T = (name: string, i: Intent, e: Environment, decision: TreasuryCase["decision"], code: string | null, g: Partial<TreasuryGuard> = {}): TreasuryCase => ({
  name,
  policy: guardPolicy(g),
  intent: i,
  state: EMPTY_STATE,
  env: e,
  decision,
  code,
});

const transfer = intent(PROJECT, "0xa9059cbb");
const approve = intent(PROJECT, "0x095ea7b3");
const sell = intent(CURVE, "0xd96a094a");
const swap = intent(ROUTER, SWAP);
const multi = intent(MULTICALL, MULTI);
const unknown = intent(UNKNOWN, "0xdeadbeef");
const U = (2n ** 256n - 1n).toString();

export const TREASURY_CASES: TreasuryCase[] = [
  // Destinations.
  T("a transfer to an insider is denied", transfer, tenv(moveSim([out(INSIDER, 10)])), "DENY", "PS_TREASURY_001"),
  T("a transfer to an insider through a multicall is denied", multi, tenv(moveSim([out(CURVE, 5), out(INSIDER, 10)])), "DENY", "PS_TREASURY_001"),
  T("a transfer to an insider through an unknown contract is denied (the simulation shows it)", unknown, tenv(moveSim([out(INSIDER, 1)])), "DENY", "PS_TREASURY_001"),
  T("a transfer to the allowed vesting contract is allowed and is not a sell", transfer, tenv(moveSim([out(VESTING, 50000)]), window(2000)), "ALLOW", null),
  T("other tokens may move anywhere", unknown, tenv(moveSim([out(INSIDER, 10, "0x5fc5360d0400a0fd4f2af552add042d716f1d168")])), "ALLOW", null),
  // Daily sell cap.
  T("a sell within the cap is allowed", sell, tenv(moveSim([out(CURVE, 500)]), window(1000)), "ALLOW", null),
  T("a sell that reaches the cap exactly is allowed", sell, tenv(moveSim([out(CURVE, 1000)]), window(1000)), "ALLOW", null),
  T("the sell that would cross the cap is denied", sell, tenv(moveSim([out(CURVE, 1001)]), window(1000)), "DENY", "PS_TREASURY_002"),
  T("sells through a router and a multicall count toward the cap", multi, tenv(moveSim([out(CURVE, 800), out(ROUTER, 800)]), window(500)), "DENY", "PS_TREASURY_002"),
  T("the cap resets on a rolling 24-hour window", sell, tenv(moveSim([out(CURVE, 1500)]), window(0)), "ALLOW", null),
  T("a percentage cap uses the holdings at the window's start", swap, tenv(moveSim([out(ROUTER, 600)]), window(0, 10000)), "DENY", "PS_TREASURY_002", { daily_sell_cap: { amount: null, pct_of_holdings_bps: 500 } }),
  T("the smaller of amount and percentage applies", swap, tenv(moveSim([out(ROUTER, 400)]), window(0, 10000)), "ALLOW", null, { daily_sell_cap: { amount: tokens(2000), pct_of_holdings_bps: 500 } }),
  T("no cap set: sells through a venue are allowed", sell, tenv(moveSim([out(CURVE, 9000)]), window(0)), "ALLOW", null, { daily_sell_cap: { amount: null, pct_of_holdings_bps: null } }),
  // Approvals.
  T("an unlimited approval is denied", approve, tenv(sim({ approvals: [{ token: PROJECT as Move["token"], spender: CURVE as Move["to"], amount: U }], transfers_out: [] })), "DENY", "PS_TREASURY_003"),
  T("an approval to a spender that is not a venue is denied", approve, tenv(sim({ approvals: [{ token: PROJECT as Move["token"], spender: INSIDER as Move["to"], amount: tokens(10) }], transfers_out: [] })), "DENY", "PS_TREASURY_003"),
  T("an approval for more than the cap has left is denied", approve, tenv(sim({ approvals: [{ token: PROJECT as Move["token"], spender: CURVE as Move["to"], amount: tokens(1500) }], transfers_out: [] }), window(1000)), "DENY", "PS_TREASURY_003"),
  T("an exact approval to a venue within the cap is allowed", approve, tenv(sim({ approvals: [{ token: PROJECT as Move["token"], spender: CURVE as Move["to"], amount: tokens(500) }], transfers_out: [] }), window(1000)), "ALLOW", null),
  T("approve and sell in one call, nothing left open, is allowed", multi, tenv(moveSim([out(ROUTER, 700)], { approvals: [{ token: PROJECT as Move["token"], spender: ROUTER as Move["to"], amount: tokens(700) }], allowances_after: [{ token: PROJECT as Move["token"], spender: ROUTER as Move["to"], amount: "0" }] }), window(1000)), "ALLOW", null),
  T("approve and sell in one call, leaving too much open, is denied", multi, tenv(moveSim([out(ROUTER, 700)], { approvals: [{ token: PROJECT as Move["token"], spender: ROUTER as Move["to"], amount: tokens(1700) }], allowances_after: [{ token: PROJECT as Move["token"], spender: ROUTER as Move["to"], amount: tokens(1000) }] }), window(1000)), "DENY", "PS_TREASURY_003"),
  // Liquidity.
  T("removing protected liquidity is denied", unknown, tenv(moveSim([out(ROUTER, 5, LP)])), "DENY", "PS_TREASURY_004"),
  T("approving a protected LP token is denied", intent(LP, "0x095ea7b3"), tenv(sim({ approvals: [{ token: LP as Move["token"], spender: ROUTER as Move["to"], amount: tokens(5) }], transfers_out: [] })), "DENY", "PS_TREASURY_004"),
  T("LP tokens may move when liquidity is not protected", unknown, tenv(moveSim([out(ROUTER, 5, LP)])), "ALLOW", null, { protect_liquidity: false }),
  // Fail closed.
  T("no simulation: the token's movement is unknown, denied", sell, tenv(null), "DENY", "PS_SIM_002"),
  T("a simulation without the transfer list is denied", sell, tenv(sim({ outflows: [{ token: PROJECT, amount: tokens(1) }] })), "DENY", "PS_SIM_002"),
  T("a reverting simulation is denied", sell, tenv(moveSim([], { reverted: true })), "DENY", "PS_SIM_002"),
  T("a stale simulation is denied", sell, tenv(moveSim([out(CURVE, 1)], { observed_at: NOW - 121 })), "DENY", "PS_SIM_002"),
  T("no sell window: a sell is denied", sell, tenv(moveSim([out(CURVE, 1)]), null), "DENY", "PS_STATE_001"),
  T("a stale sell window is denied", sell, tenv(moveSim([out(CURVE, 1)]), window(0, 10000, { observed_at: NOW - 121 })), "DENY", "PS_STATE_001"),
  T("a guard that is switched off changes nothing", transfer, tenv(moveSim([out(INSIDER, 10)])), "ALLOW", null, { enabled: false }),
  T("a call without a selector is still simulated: no simulation, denied", intent(RECIPIENT, ""), tenv(null), "DENY", "PS_SIM_002"),
  T("a call without a selector that moves nothing is allowed", intent(RECIPIENT, ""), tenv(moveSim([])), "ALLOW", null),
  T("a call without a selector whose fallback moves the project token is judged by the move", intent(RECIPIENT, ""), tenv(moveSim([out(INSIDER, 1)])), "DENY", "PS_TREASURY_001"),
];

export { ACCOUNT };

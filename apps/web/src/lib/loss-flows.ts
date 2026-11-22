/**
 * Phase 9, loss limits: separating deposits and withdrawals from trading results, and the window's
 * peak. Pure functions, shared by the server's snapshots and unit-tested.
 *
 * Every Palisec account is a Safe that cannot move funds without Palisec's co-signature, so a
 * transaction in which the Safe itself executed (it emits ExecutionSuccess or ExecutionFromModuleSuccess,
 * or the failure variants) is one of its own operations. Then:
 *  - incoming, in a transaction the Safe did not execute    -> deposit (raises the flows)
 *  - outgoing to an exit address, in an executed transaction -> withdrawal (lowers the flows)
 *  - everything else (swap legs, payments, fees, an approved spender pulling tokens) -> trading result
 * The adjusted value A = value - flows moves only with trading results and prices.
 */

export const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

/** One balance movement seen on chain. `token` is lowercase, NATIVE for ETH. */
export interface Movement {
  tx: string;
  token: string;
  direction: "in" | "out";
  /** Counterparty, lowercase (sender for "in", recipient for "out"). */
  other: string;
  amount: bigint;
}

export interface FlowItem extends Movement {
  kind: "deposit" | "withdrawal";
}

/** The movements that are deposits or withdrawals; everything else is a trading result. */
export function externalFlows(moves: Movement[], executedTxs: Set<string>, exits: Set<string>): FlowItem[] {
  const out: FlowItem[] = [];
  for (const m of moves) {
    const executed = executedTxs.has(m.tx.toLowerCase());
    if (m.direction === "in" && !executed) out.push({ ...m, kind: "deposit" });
    else if (m.direction === "out" && executed && exits.has(m.other)) out.push({ ...m, kind: "withdrawal" });
  }
  return out;
}

/** USD micros for `amount` base units at `price` micros per whole token, rounded down. */
export const usdOf = (amount: bigint, price: bigint, decimals: number) => (amount * price) / 10n ** BigInt(decimals);

/** Net USD of deposits minus withdrawals; null when a moved token has no price (the snapshot is then unavailable). */
export function flowsUsd(items: FlowItem[], prices: Map<string, { price: bigint; decimals: number }>, priced: Set<string>): bigint | null {
  let net = 0n;
  for (const f of items) {
    if (!priced.has(f.token)) continue; // a token with no price is worth $0 to the loss limit, in and out
    const p = prices.get(f.token);
    if (!p) return null;
    const v = usdOf(f.amount, p.price, p.decimals);
    net += f.kind === "deposit" ? v : -v;
  }
  return net;
}

/**
 * The window's peak, at today's flows: max over snapshots s of (value_s - flows_s), plus flows now.
 * The current snapshot is always included, so the result is at least the current value. Never negative.
 */
export function peakNow(snapshots: { value: bigint; flows: bigint }[], current: { value: bigint; flows: bigint }): bigint {
  let best = current.value - current.flows;
  for (const s of snapshots) if (s.value - s.flows > best) best = s.value - s.flows;
  const peak = best + current.flows;
  return peak > 0n ? peak : 0n;
}

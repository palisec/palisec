/*
 * Account value for a policy replay against a Zolva agent's recorded trades.
 *
 * Zolva publishes the agent's hourly value for the last 7 days. Older hours are rebuilt from the recorded
 * trades (cash from the start capital, fills and costs) and Zolva's hourly closes. The rebuild is used only
 * when every trade is published and it matches Zolva's own value wherever both exist; an hour it cannot
 * value (a held market without a close yet) is null, so a loss limit fails closed on it.
 */

export interface ValueTrade { at: string; market: string; side: string; quantity: number; price: number; cost_usd: number }
/** [unix seconds, USD], oldest first. */
export type Closes = [number, number][];
/** [unix seconds, USD or null when it cannot be valued], oldest first. */
export type Values = [number, number | null][];

/** The last close at or before `t`, or null. */
export function priceAt(list: Closes, t: number): number | null {
  let best: number | null = null;
  for (const [ts, p] of list) if (ts <= t) best = p;
  return best;
}

/** Hours before the first trade covered by the rebuild (the longest loss-limit window). */
const LEAD_SECONDS = 7 * 86400;
/** The rebuild never goes further back than this (Zolva's closes cover 30 days); older trades have no value. */
export const MAX_REBUILD_HOURS = 45 * 24;

export function rebuildValues(input: {
  /** Zolva's hourly value: [unix seconds, agent value, ...], oldest first. */
  equity: readonly (readonly number[])[];
  startCapital: number | null;
  tradesCount: number | null;
  /** The published trades, oldest first. */
  trades: readonly ValueTrade[];
  /** Hourly closes per market symbol (upper case), or null when they could not be read. */
  closes: Map<string, Closes> | null;
}): { values: Values; rebuilt: boolean } {
  const own: Values = input.equity.map((r) => [r[0]!, r[1]!]);
  const { startCapital: cap, trades, closes } = input;
  if (own.length === 0 || cap === null || closes === null || trades.length === 0 || input.tradesCount !== trades.length) return { values: own, rebuilt: false };
  if (trades.some((t) => t.side !== "buy" && t.side !== "sell")) return { values: own, rebuilt: false };
  const times = trades.map((t) => Date.parse(t.at) / 1000);
  if (times.some((t, i) => !Number.isFinite(t) || (i > 0 && t < times[i - 1]!))) return { values: own, rebuilt: false };

  const valueAt = (at: number): number | null => {
    let cash = cap;
    const held = new Map<string, number>();
    for (let i = 0; i < trades.length && times[i]! <= at; i++) {
      const t = trades[i]!;
      const s = t.market.toUpperCase();
      const sign = t.side === "buy" ? 1 : -1;
      cash += -sign * t.quantity * t.price - t.cost_usd;
      held.set(s, (held.get(s) ?? 0) + sign * t.quantity);
    }
    let value = cash;
    for (const [s, q] of held) {
      if (Math.abs(q) < 1e-9) continue;
      const p = priceAt(closes.get(s) ?? [], at);
      if (p === null) return null;
      value += q * p;
    }
    return value;
  };

  // Checked against Zolva's own value: a difference above a cent per 1,000 USD and the rebuild is not used.
  for (const [t, v] of own) {
    const r = valueAt(t);
    if (r === null || v === null || Math.abs(r - v) > Math.max(0.01, Math.abs(v) * 1e-5)) return { values: own, rebuilt: false };
  }
  const first = Math.max(times[0]! - LEAD_SECONDS, own[0]![0] - MAX_REBUILD_HOURS * 3600);
  const before: Values = [];
  for (let t = own[0]![0] - 3600; t >= first; t -= 3600) before.push([t, valueAt(t)]);
  return { values: [...before.reverse(), ...own], rebuilt: before.length > 0 };
}

/** The account value at `now` and the peak over the window before it; null when any hour of the window has no value. */
export function windowValue(values: Values, now: number, windowSeconds: number): { value: number; peak: number } | null {
  if (values.length === 0 || now - windowSeconds < values[0]![0] - 3600 || now > values[values.length - 1]![0] + 3600) return null;
  const inWindow = values.filter(([ts]) => ts <= now && ts > now - windowSeconds);
  const current = [...values].reverse().find(([ts]) => ts <= now);
  if (!current || current[1] === null || inWindow.length === 0 || inWindow.some(([, v]) => v === null)) return null;
  const peak = inWindow.reduce((mx, [, v]) => (v! > mx ? v! : mx), 0);
  return { value: current[1], peak };
}

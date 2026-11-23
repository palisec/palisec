import "server-only";
import { evaluateDual } from "@palisec/policy-engine";
import {
  NATIVE_TOKEN,
  type CheckResult,
  type Environment,
  type Intent,
  type LedgerState,
  type LossSnapshot,
  type Policy,
  type ReasonCode,
} from "@palisec/policy-schema";
import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";
import { BadRequest, HttpError } from "./http";
import { priceAt, rebuildValues, windowValue, type Closes, type Values } from "@/lib/replay-values";
import { zolvaRecord, type ZolvaTrade } from "./zolva";

/*
 * Test a policy before going live: replays a Palisec policy (both engines, the real document) against a
 * Zolva agent's recorded trades, oldest first, and reports which ones it would have blocked and why.
 *
 * Read only. Nothing is recorded, reserved, signed or sent, and enforcement is unchanged. Inputs the
 * past cannot give exactly are reconstructed and labelled:
 * - each spot trade becomes an exact-input swap on Uniswap's SwapRouter02 from the policy's account,
 *   spending USDG for a buy and the token for a sell, at Zolva's recorded quantity and price;
 * - the balance changes are the recorded ones (Zolva's paper fills), used as the simulation;
 * - ETH/USD is Zolva's hourly ETH close at the trade's hour; the fee is a fixed 0.00002 ETH;
 * - for a loss limit, the account value and window peak come from Zolva's hourly value (last 7 days), extended
 *   back by rebuilding it from the recorded trades and Zolva's hourly closes. The rebuild is used only when the
 *   agent's full trade list is published and it matches Zolva's own value wherever both exist; any hour it cannot
 *   value leaves the trade without a value, so a loss limit fails closed on it, as it would live.
 * Amounts can be scaled to the account's own size (`capital_usd`).
 */

const SWAP_ROUTER: Address = "0xcaf681a66d020601342297493863e78c959e5cb2";
const USDG: Address = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const FEE_WEI = "20000000000000";
const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256)",
]);

interface Market { symbol: string; address: Address; decimals: number; venue: string }
let marketCache: { at: number; list: Market[] } | null = null;
const closesCache = new Map<string, { at: number; closes: [number, number][] }>();

async function zolvaPublic(path: string): Promise<unknown> {
  const t = process.env.PALISEC_TEST_ZOLVA_URL;
  const base = process.env.VERCEL_ENV !== "production" && t && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(t) ? t : "https://zolvaagent.app/api/public/v1";
  const headers: Record<string, string> = { accept: "application/json" };
  if (/^zk_[A-Za-z0-9_-]{16,}$/.test(process.env.ZOLVA_API_KEY ?? "")) headers.authorization = `Bearer ${process.env.ZOLVA_API_KEY}`;
  const r = await fetch(`${base}${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (r.status === 429) throw new HttpError(503, "PS_STATE_001", "Zolva asked us to slow down. Try again in a few minutes.", true);
  if (!r.ok) throw new HttpError(503, "PS_STATE_001", "Zolva could not be read just now. Try again later.", true);
  const text = await r.text();
  if (text.length > 1024 * 1024) throw new HttpError(503, "PS_STATE_001", "Zolva's answer was too large.", true);
  return JSON.parse(text);
}

/** Zolva's spot markets with their token on Robinhood Chain (cached 5 minutes). */
async function markets(): Promise<Market[]> {
  if (marketCache && Date.now() - marketCache.at < 300_000) return marketCache.list;
  const body = (await zolvaPublic("/markets")) as { markets?: Record<string, unknown>[] };
  const list = (body.markets ?? [])
    .filter((m) => typeof m.symbol === "string" && typeof m.address === "string" && /^0x[0-9a-fA-F]{40}$/.test(m.address as string))
    .map((m) => ({ symbol: String(m.symbol).toUpperCase(), address: getAddress(m.address as string), decimals: String(m.symbol).toUpperCase() === "USDG" ? 6 : 18, venue: String(m.venue) }));
  marketCache = { at: Date.now(), list };
  return list;
}

/** Zolva's hourly closes for a market, [unix seconds, USD], oldest first, up to 30 days (cached 5 minutes). */
async function closes(symbol: string): Promise<[number, number][]> {
  const hit = closesCache.get(symbol);
  if (hit && Date.now() - hit.at < 300_000) return hit.closes;
  const body = (await zolvaPublic(`/markets/${encodeURIComponent(symbol)}`)) as { closes?: unknown[] };
  const list = (body.closes ?? [])
    .map((r) => (Array.isArray(r) ? ([Date.parse(String(r[0])) / 1000, Number(r[1])] as [number, number]) : null))
    .filter((r): r is [number, number] => !!r && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > 0);
  closesCache.set(symbol, { at: Date.now(), closes: list });
  return list;
}

const micros = (usd: number) => BigInt(Math.max(0, Math.round(usd * 1e6)));
const units = (qty: number, decimals: number) => {
  // Six significant decimals from the float, then exact integer scaling.
  const fixed = Math.max(0, qty).toFixed(6).replace(".", "");
  return (BigInt(fixed) * 10n ** BigInt(decimals)) / 1_000_000n;
};

export interface ReplayRow {
  at: string;
  market: string;
  side: string;
  size_usd: number;
  decision: "ALLOW" | "DENY" | "REQUIRES_HUMAN_SIGNATURE" | "NOT_REPLAYED";
  reason_code: ReasonCode | null;
  check: string | null;
  detail: string;
}

export interface ReplayResult {
  zolva_agent_id: string;
  policy: { id: string; version: number | null; which: "active" | "draft" };
  scale: number;
  capital_usd: number | null;
  trades: number;
  replayed: number;
  allowed: number;
  blocked: number;
  review: number;
  by_reason: Record<string, number>;
  rows: ReplayRow[];
  assumptions: string[];
  paper_trading: true;
  disclaimer: string;
}

export async function replayPolicy(policy: Policy, which: "active" | "draft", zolvaId: string, capitalUsd: number | null): Promise<ReplayResult> {
  if (capitalUsd !== null && (!Number.isFinite(capitalUsd) || capitalUsd < 1 || capitalUsd > 1e9)) throw new BadRequest("capital_usd must be between 1 and 1,000,000,000");
  const cached = await zolvaRecord(zolvaId);
  const rec = cached.record;
  if (!rec) throw new HttpError(404, "PS_REQUEST_001", cached.error === "zolva_not_found" ? "No published Zolva agent with this ID." : "Zolva's record is not available right now. Try again later.");
  const start = rec.start_capital_usd ?? null;
  const scale = capitalUsd !== null && start ? capitalUsd / start : 1;
  const account = getAddress(policy.account.address);
  const doc: Policy = { ...policy, status: "active", version: policy.version || 1 };
  const assumptions = [
    "Paper trading with virtual money: these are Zolva's recorded paper trades, not trades that ran through Palisec.",
    "Each spot trade is replayed as an exact-input swap on Uniswap's SwapRouter02 from the policy's account, at Zolva's recorded quantity and price.",
    "The balance changes are the recorded fills (used in place of a live simulation); ETH/USD is Zolva's hourly ETH close; the network fee is a fixed 0.00002 ETH.",
    ...(scale !== 1 ? [`Amounts are scaled by ${scale.toFixed(4)} to a ${capitalUsd} USD account.`] : []),
  ];
  const trades = [...rec.trades].sort((a, b) => (a.at < b.at ? -1 : 1));
  const empty = { zolva_agent_id: zolvaId, policy: { id: doc.policy_id, version: policy.version ?? null, which }, scale, capital_usd: capitalUsd, paper_trading: true as const, disclaimer: rec.disclaimer, assumptions };
  if (rec.venue !== "spot") {
    const rows: ReplayRow[] = trades.map((t) => ({ at: t.at, market: t.market, side: t.side, size_usd: t.quantity * t.price * scale, decision: "NOT_REPLAYED", reason_code: null, check: null, detail: "Perpetual futures trades have no on-chain equivalent on Robinhood Chain; Palisec replays spot trades only." }));
    return { ...empty, trades: rows.length, replayed: 0, allowed: 0, blocked: 0, review: 0, by_reason: {}, rows };
  }
  const [mk, eth] = await Promise.all([markets(), closes("ETH")]);
  const bySymbol = new Map(mk.map((m) => [m.symbol, m]));
  const { values, rebuilt } = doc.loss_limit?.enabled ? await accountValues() : { values: [] as Values, rebuilt: false };
  if (doc.loss_limit?.enabled)
    assumptions.push(
      rebuilt
        ? "A loss limit uses Zolva's hourly account value for the last 7 days, and before that the value rebuilt from the recorded trades and Zolva's hourly closes (it matches Zolva's own value wherever both exist). Trades at hours that cannot be valued fail closed."
        : "A loss limit uses Zolva's hourly account value, which covers the last 7 days only; older trades have no value and fail closed.",
    );
  let state: LedgerState = { reservations: [], seen_request_ids: [], calldata_seen: {}, intent_seen: {} };
  let paused: "PS_LOSS_001" | "PS_LOSS_002" | null = null;
  const rows: ReplayRow[] = [];
  trades.forEach((t, i) => rows.push(replayOne(t, i)));

  function replayOne(t: ZolvaTrade, i: number): ReplayRow {
    const base = { at: t.at, market: t.market, side: t.side, size_usd: Math.round(t.quantity * t.price * scale * 100) / 100 };
    const m = bySymbol.get(t.market.toUpperCase());
    if (!m || m.venue !== "spot") return { ...base, decision: "NOT_REPLAYED", reason_code: null, check: null, detail: `No spot token for ${t.market} on Robinhood Chain in Zolva's market list.` };
    if (t.side !== "buy" && t.side !== "sell") return { ...base, decision: "NOT_REPLAYED", reason_code: null, check: null, detail: "Short positions have no spot swap equivalent." };
    const now = Math.floor(Date.parse(t.at) / 1000);
    const usdg = micros(t.quantity * t.price * scale);
    const tok = units(t.quantity * scale, m.decimals);
    const [tokenIn, tokenOut, amountIn, amountOut] = t.side === "buy" ? [USDG, m.address, usdg, tok] : [m.address, USDG, tok, usdg];
    const data = encodeFunctionData({
      abi: ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [{ tokenIn, tokenOut, fee: 3000, recipient: account, amountIn, amountOutMinimum: (amountOut * 97n) / 100n, sqrtPriceLimitX96: 0n }],
    });
    const intent: Intent = {
      request_id: `zolva-replay-${i}`,
      agent_id: "zolva-replay",
      chain_id: doc.account.chain_id,
      from: account,
      to: SWAP_ROUTER,
      value_wei: "0",
      data,
      deadline: now + 120,
      asset_intent: { spend: [{ token: tokenIn.toLowerCase() as Address, amount: amountIn.toString() }], receive: [{ token: tokenOut.toLowerCase() as Address, amount: amountOut.toString() }] },
    };
    const ethUsd = priceAt(eth, now);
    const env: Environment = {
      now,
      fee_estimate_wei: FEE_WEI,
      eth_usd: ethUsd ? { price_micros: micros(ethUsd).toString(), observed_at: now } : null,
      verified_code: { [SWAP_ROUTER]: true },
      emergency_stop: false,
      paused_agents: [],
      asset_simulation: {
        block_number: 0,
        observed_at: now,
        reverted: false,
        outflows: [{ token: tokenIn.toLowerCase() as Address, amount: amountIn.toString() }],
        inflows: [{ token: tokenOut.toLowerCase() as Address, amount: amountOut.toString() }],
        approvals: [],
        sell: { reverted: false },
        tax_bps: 0,
        round_trip_loss_bps: null,
      },
      loss_snapshot: doc.loss_limit?.enabled ? lossAt(now, m, t.price) : undefined,
    };
    let r;
    try {
      r = evaluateDual(doc, intent, state, env);
    } catch {
      return { ...base, decision: "DENY", reason_code: "PS_STATE_001", check: "engine", detail: "The engines could not evaluate this trade; a live decision would fail closed." };
    }
    state = r.next_state;
    if (r.decision === "DENY" && (r.reason_code === "PS_LOSS_001" || r.reason_code === "PS_LOSS_002")) paused ??= r.reason_code;
    const deciding: CheckResult | undefined = r.checks.find((c) => c.status === "fail") ?? r.checks.find((c) => c.status === "review");
    return { ...base, decision: r.decision, reason_code: r.reason_code, check: deciding?.label ?? null, detail: deciding?.detail ?? r.message };
  }

  /** Hourly account value: Zolva's own, extended back by the rebuild from trades and closes (lib/replay-values). */
  async function accountValues(): Promise<{ values: Values; rebuilt: boolean }> {
    const symbols = [...new Set(trades.map((t) => t.market.toUpperCase()))];
    let closesBy: Map<string, Closes> | null = null;
    try {
      closesBy = new Map(await Promise.all(symbols.map(async (s) => [s, await closes(s)] as const)));
    } catch {
      closesBy = null;
    }
    return rebuildValues({ equity: rec!.equity, startCapital: rec!.start_capital_usd, tradesCount: rec!.trades_count, trades, closes: closesBy });
  }

  /** Account value and window peak at `now`, scaled; null when any hour of the window has no value. */
  function lossAt(now: number, m: Market, price: number): LossSnapshot | null {
    const w = windowValue(values, now, doc.loss_limit!.window_seconds);
    if (!w) return null;
    const value = micros(w.value * scale);
    const peak = w.peak;
    return {
      observed_at: now,
      value_usd_micros: value.toString(),
      baseline_usd_micros: (micros(peak * scale) > value ? micros(peak * scale) : value).toString(),
      paused,
      prices: [
        { token: USDG, price_micros: "1000000", decimals: 6 },
        { token: m.address.toLowerCase() as Address, price_micros: micros(price).toString(), decimals: m.decimals },
        ...(ethPrice(now) ? [{ token: NATIVE_TOKEN, price_micros: ethPrice(now)!, decimals: 18 }] : []),
      ],
      unavailable: [],
    };
  }
  function ethPrice(now: number): string | null {
    const p = priceAt(eth, now);
    return p ? micros(p).toString() : null;
  }

  const replayed = rows.filter((r) => r.decision !== "NOT_REPLAYED");
  const by_reason: Record<string, number> = {};
  for (const r of replayed) if (r.reason_code) by_reason[r.reason_code] = (by_reason[r.reason_code] ?? 0) + 1;
  return {
    ...empty,
    trades: rows.length,
    replayed: replayed.length,
    allowed: replayed.filter((r) => r.decision === "ALLOW").length,
    blocked: replayed.filter((r) => r.decision === "DENY").length,
    review: replayed.filter((r) => r.decision === "REQUIRES_HUMAN_SIGNATURE").length,
    by_reason,
    rows: rows.reverse(),
  };
}

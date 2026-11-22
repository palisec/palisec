import "server-only";
import { NATIVE_TOKEN } from "@palisec/policy-schema";
import { createPublicClient, getAddress, parseAbi, type Address } from "viem";
import { ethUsd, usdgUsdMicros } from "./chain-env";
import { CHAINS, chainTransport, type ChainId } from "./config";
import { MAINNET, TESTNET } from "@/lib/networks";

/*
 * Phase 9, loss limits: what each asset is worth, from Chainlink on Robinhood Chain. Never from a DEX
 * pool or a single block's spot price. Every price is checked (positive, fresh, not paused, cross-checked);
 * a price that fails a check is "unavailable", and the engines then refuse anything that adds risk.
 *
 * Only the assets listed here have a price. Every other token is worth $0 to the loss limit (buying one
 * counts the whole spend as a loss), so a junk token with a made-up value can never hide a loss.
 * Stock-token addresses were checked on chain on 2026-11-22: symbol, 18 decimals, `oraclePaused()` and
 * `uiMultiplier()`, and the matching Chainlink feed's description.
 */

export type AssetKind = "crypto" | "stablecoin" | "equity";
export interface PricedAsset {
  token: string; // lowercase; NATIVE_TOKEN for ETH
  symbol: string;
  decimals: number;
  kind: AssetKind;
  /** Chainlink proxy (8 decimals); null on testnet, where the app's ETH price is used instead. */
  feed: Address | null;
}

const ETH_FEED = "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9";
export const ASSETS: Record<ChainId, PricedAsset[]> = {
  [MAINNET]: [
    { token: NATIVE_TOKEN, symbol: "ETH", decimals: 18, kind: "crypto", feed: ETH_FEED },
    { token: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", symbol: "WETH", decimals: 18, kind: "crypto", feed: ETH_FEED },
    { token: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6, kind: "stablecoin", feed: "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2" },
    { token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", symbol: "NVDA", decimals: 18, kind: "equity", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
    { token: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", symbol: "TSLA", decimals: 18, kind: "equity", feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
    { token: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", symbol: "AAPL", decimals: 18, kind: "equity", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  ],
  // Chainlink has no testnet feeds: native ETH only, at the app's exchange price, so testnet trials work.
  [TESTNET]: [{ token: NATIVE_TOKEN, symbol: "ETH", decimals: 18, kind: "crypto", feed: null }],
};

/** Chainlink's heartbeat for every Robinhood Chain feed is 24 h (0.5 % deviation); a little grace on top. */
const HEARTBEAT_SECONDS = 86400;
const GRACE_SECONDS = 3600;
/** Chainlink ETH/USD must be within this of the exchange price the app already reads. */
const CROSS_CHECK_BPS = 200n;
/** USDG more than 2 % away from $1 (on Chainlink or on the exchanges) has no price. */
const DEPEG_BPS = 200n;
const PRICE_TTL_MS = 15_000;

const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const TOKEN_ABI = parseAbi(["function oraclePaused() view returns (bool)"]);

export type Price =
  | { ok: true; token: string; price_micros: bigint; decimals: number; observed_at: number; source: string }
  | { ok: false; token: string; reason: string };

/**
 * Whether US equities are in Robinhood's 24/5 session: Sunday 20:00 to Friday 20:00, New York time.
 * Outside it a stock feed does not update, so its last price is accepted for longer (the policy's
 * max_closed_market_price_age_seconds). Exchange holidays are not modelled: a stale price on a holiday
 * is simply unavailable (fails closed).
 */
export function equityMarketOpen(unixSeconds: number): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(unixSeconds * 1000));
  const day = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  if (day === "Sat") return false;
  if (day === "Fri") return hour < 20;
  if (day === "Sun") return hour >= 20;
  return true;
}

const bpsOff = (a: bigint, b: bigint) => ((a > b ? a - b : b - a) * 10000n) / b;

const cache = new Map<string, { at: number; value: Price }>();

/**
 * Checks one Chainlink answer: positive, complete, fresh enough for its kind and the market session.
 * Answers are 8 decimals; micros are 6, rounded down.
 */
export function checkAnswer(
  asset: PricedAsset,
  round: { answer: bigint; updatedAt: number; roundId: bigint; answeredInRound: bigint },
  now: number,
  closedMarketMaxAge: number,
): Price {
  if (round.answer <= 0n) return { ok: false, token: asset.token, reason: `${asset.symbol}: Chainlink answer is not positive` };
  if (round.answeredInRound < round.roundId) return { ok: false, token: asset.token, reason: `${asset.symbol}: Chainlink round incomplete` };
  const age = now - round.updatedAt;
  const fresh = HEARTBEAT_SECONDS + GRACE_SECONDS;
  const max = asset.kind === "equity" && !equityMarketOpen(now) ? Math.max(fresh, closedMarketMaxAge) : fresh;
  if (age > max) return { ok: false, token: asset.token, reason: `${asset.symbol}: Chainlink price is ${age}s old (maximum ${max}s)` };
  return { ok: true, token: asset.token, price_micros: round.answer / 100n, decimals: asset.decimals, observed_at: round.updatedAt, source: `chainlink:${asset.feed}` };
}

async function priceOf(chainId: ChainId, asset: PricedAsset, now: number, closedMarketMaxAge: number): Promise<Price> {
  const key = `${chainId}:${asset.token}:${closedMarketMaxAge}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.value;
  const value = await loadPrice(chainId, asset, now, closedMarketMaxAge).catch((): Price => ({ ok: false, token: asset.token, reason: `${asset.symbol}: price read failed` }));
  if (value.ok) cache.set(key, { at: Date.now(), value });
  return value;
}

async function loadPrice(chainId: ChainId, asset: PricedAsset, now: number, closedMarketMaxAge: number): Promise<Price> {
  if (!asset.feed) {
    const p = await ethUsd();
    if (!p) return { ok: false, token: asset.token, reason: "ETH: exchange price unavailable" };
    return { ok: true, token: asset.token, price_micros: BigInt(p.price_micros), decimals: 18, observed_at: p.observed_at, source: "exchange (testnet)" };
  }
  const c = createPublicClient({ transport: chainTransport(chainId, 5000) });
  const [r, paused, crossEth, crossUsdg] = await Promise.all([
    c.readContract({ address: asset.feed, abi: FEED_ABI, functionName: "latestRoundData" }),
    asset.kind === "equity" ? c.readContract({ address: getAddress(asset.token), abi: TOKEN_ABI, functionName: "oraclePaused" }) : false,
    asset.kind === "crypto" ? ethUsd() : null,
    asset.kind === "stablecoin" ? usdgUsdMicros() : null,
  ]);
  if (paused) return { ok: false, token: asset.token, reason: `${asset.symbol}: oracle paused for a corporate action` };
  const p = checkAnswer(asset, { roundId: r[0], answer: r[1], updatedAt: Number(r[3]), answeredInRound: r[4] }, now, closedMarketMaxAge);
  if (!p.ok) return p;
  if (asset.kind === "crypto") {
    if (!crossEth) return { ok: false, token: asset.token, reason: `${asset.symbol}: no exchange price to cross-check Chainlink` };
    if (bpsOff(p.price_micros, BigInt(crossEth.price_micros)) > CROSS_CHECK_BPS)
      return { ok: false, token: asset.token, reason: `${asset.symbol}: Chainlink and the exchange price differ by more than 2%` };
  }
  if (asset.kind === "stablecoin") {
    if (bpsOff(p.price_micros, 1_000_000n) > DEPEG_BPS) return { ok: false, token: asset.token, reason: `${asset.symbol}: Chainlink price is more than 2% away from $1` };
    if (crossUsdg === null) return { ok: false, token: asset.token, reason: `${asset.symbol}: no exchange price for the depeg check` };
    if (bpsOff(crossUsdg, 1_000_000n) > DEPEG_BPS) return { ok: false, token: asset.token, reason: `${asset.symbol}: trades more than 2% away from $1` };
  }
  return p;
}

/** Every priced asset on the chain, checked. Unknown chains have none. */
export async function pricesFor(chainId: number, closedMarketMaxAge: number): Promise<Price[]> {
  const list = ASSETS[chainId as ChainId];
  if (!list || !CHAINS[chainId as ChainId]?.enabled) return [];
  const now = Math.floor(Date.now() / 1000);
  return Promise.all(list.map((a) => priceOf(chainId as ChainId, a, now, closedMarketMaxAge)));
}

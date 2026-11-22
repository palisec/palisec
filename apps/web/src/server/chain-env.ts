import "server-only";
import { createPublicClient, type Address } from "viem";
import { CHAINS, chainTransport, type ChainId } from "./config";

/**
 * External inputs to an evaluation. Each lookup may fail; a failure returns null and the evaluator
 * fails closed (PS_FEE_001 or PS_STATE_001), never treating an unknown value as zero.
 * Results are cached briefly per server instance to keep latency and RPC usage low.
 */

const PRICE_URL = "https://api.coinbase.com/v2/prices/ETH-USD/spot";
const FALLBACK_PRICE_URL = "https://api.kraken.com/0/public/Ticker?pair=ETHUSD";
const GAS_TTL_MS = 15_000;
const PRICE_TTL_MS = 15_000;
const CODE_TTL_MS = 10 * 60_000;

const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  if (value !== null) cache.set(key, { at: Date.now(), value });
  return value;
}

function client(chainId: number) {
  const chain = CHAINS[chainId as ChainId];
  if (!chain?.enabled) return null;
  return createPublicClient({ transport: chainTransport(chainId as ChainId, 5000) });
}

/** Current gas price in wei, or null when the chain cannot be reached. */
export function gasPriceWei(chainId: number): Promise<bigint | null> {
  return cached(`gas:${chainId}`, GAS_TTL_MS, async () => {
    const c = client(chainId);
    return c ? c.getGasPrice().catch(() => null) : null;
  });
}

/**
 * Whether the address has deployed contract code. This is the only "verified code" check in this
 * release: it proves a contract exists at the address, not that its source was reviewed.
 */
export function hasDeployedCode(chainId: number, address: Address): Promise<boolean | null> {
  return cached(`code:${chainId}:${address.toLowerCase()}`, CODE_TTL_MS, async () => {
    const c = client(chainId);
    if (!c) return null;
    const code = await c.getCode({ address }).catch(() => null);
    return code === null ? null : code !== undefined && code !== "0x";
  });
}

/** Parses a decimal such as "2316.67" into integer micros without floating point. */
export function decimalToMicros(s: string): bigint | null {
  const m = /^(\d{1,12})(?:\.(\d{1,18}))?$/.exec(s);
  if (!m) return null;
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}

async function fetchPrice(url: string, pick: (body: any) => unknown): Promise<bigint | null> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return null;
    const v = pick(await res.json());
    const micros = typeof v === "string" ? decimalToMicros(v) : null;
    return micros && micros > 0n ? micros : null;
  } catch {
    return null;
  }
}

/** ETH/USD spot price in micros with the time it was observed (unix seconds), or null. */
export function ethUsd(): Promise<{ price_micros: string; observed_at: number } | null> {
  return cached("eth-usd", PRICE_TTL_MS, async () => {
    const micros =
      (await fetchPrice(PRICE_URL, (b) => b?.data?.amount)) ??
      (await fetchPrice(FALLBACK_PRICE_URL, (b) => b?.result?.XETHZUSD?.c?.[0]));
    return micros ? { price_micros: micros.toString(), observed_at: Math.floor(Date.now() / 1000) } : null;
  });
}

/**
 * Phase 9: USDG/USD from the same two exchanges, only as a depeg check next to Chainlink (never as the
 * value). Micros, or null.
 */
export function usdgUsdMicros(): Promise<bigint | null> {
  return cached("usdg-usd", PRICE_TTL_MS, async () =>
    (await fetchPrice("https://api.coinbase.com/v2/prices/USDG-USD/spot", (b) => b?.data?.amount)) ??
    (await fetchPrice("https://api.kraken.com/0/public/Ticker?pair=USDGUSD", (b) => b?.result?.USDGUSD?.c?.[0])),
  );
}

export const PRICE_SOURCE ="Coinbase public spot price (ETH-USD), falling back to Kraken's last trade";

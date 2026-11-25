import "server-only";
import { createPublicClient, parseAbi, type Address } from "viem";
import { REGISTRY_ADDRESSES } from "policy-enforced-accounts";
import { MAINNET } from "@/lib/networks";
import type { HealthCheck } from "@/lib/health-status";
import { billingSettings } from "./billing";
import { CHAINS, chainTransport, isDatabaseConfigured } from "./config";
import { db } from "./db";
import { publicProof } from "./public-data";
import { pricesFor } from "./valuation";

/**
 * The status rows for the public site's parts: registry, price feeds, loss measurements, Zolva feed, credits
 * and the public proof data. Each is a real check. Cached for 5 minutes so the hourly uptime check and the
 * status page cost little. None of them can stop decisions, so each is `critical: "none"`.
 */
const CACHE_MS = 5 * 60_000;
const TWO_HOURS = 2 * 3600_000;
/** Equity feeds pause while markets are closed (weekends, holidays); allow four days there. */
const CLOSED_MARKET_MAX_AGE = 4 * 86400;
let cached: { at: number; checks: HealthCheck[] } | null = null;

const row = (id: string, label: string, ok: boolean, state: string, reason: string | null, configured = true): HealthCheck => ({
  id, label, critical: "none", configured, ok, verified: configured, state, reason: ok ? null : reason,
});

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export async function publicStatusChecks(): Promise<HealthCheck[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.checks;
  const mainnetOn = CHAINS[MAINNET]?.enabled === true;
  const client = createPublicClient({ transport: chainTransport(MAINNET, 5000) });
  const registry = REGISTRY_ADDRESSES[MAINNET] as Address;
  const credits = billingSettings().contract;
  const hasDb = isDatabaseConfigured();

  const [registryOk, prices, lossAt, zolvaAt, creditsCode, proof] = await Promise.all([
    mainnetOn
      ? settle(client.readContract({ address: registry, abi: parseAbi(["function supportsInterface(bytes4) view returns (bool)"]), functionName: "supportsInterface", args: ["0xf594edcd"] }))
      : Promise.resolve(null),
    mainnetOn ? settle(pricesFor(MAINNET, CLOSED_MARKET_MAX_AGE)) : Promise.resolve(null),
    hasDb ? settle(db()`SELECT max(taken_at) AS at FROM loss_snapshots`.then((r) => (r[0]?.at ? new Date(r[0].at).getTime() : null))) : Promise.resolve(null),
    hasDb ? settle(db()`SELECT max(fetched_at) AS at FROM zolva_cache`.then((r) => (r[0]?.at ? new Date(r[0].at).getTime() : null))) : Promise.resolve(null),
    credits && mainnetOn ? settle(client.getCode({ address: credits })) : Promise.resolve(null),
    hasDb ? settle(publicProof({ limit: 1, page: 1, result: "all" })) : Promise.resolve(null),
  ]);

  const now = Date.now();
  const stalePrices = prices ? prices.filter((p) => !p.ok).length : null;
  const checks: HealthCheck[] = [
    row("registry", "Policy registry (ERC-8511)", registryOk === true, registryOk === true ? "ok" : "unreachable", "The registry v3 could not be read on chain."),
    row("price_feeds", "Price feeds", stalePrices === 0, stalePrices === 0 ? "ok" : prices ? "stale" : "unreachable",
      prices ? `${stalePrices} Chainlink feed(s) are past their heartbeat; spending in those tokens is refused until they update.` : "The Chainlink feeds could not be read."),
    row("loss_measurements", "Loss limit measurements", lossAt !== null && now - lossAt < TWO_HOURS, lossAt ? "ok" : "unknown",
      "The hourly loss measurement has not run in the last 2 hours.", hasDb),
    row("zolva_feed", "Zolva feed", zolvaAt !== null && now - zolvaAt < TWO_HOURS, zolvaAt ? "ok" : "unknown",
      "Zolva has not been read successfully in the last 2 hours; the last good data is shown.", hasDb),
    row("credits", "Credits and burns", typeof creditsCode === "string" && creditsCode.length > 2, credits ? (creditsCode ? "ok" : "unreachable") : "not_configured",
      credits ? "The credits contract could not be read." : "The credits contract address is not configured.", Boolean(credits)),
    row("public_proof", "Public proof data", proof !== null && !proof.stale, proof ? (proof.stale ? "stale" : "ok") : "unavailable",
      "The public proof data could not be read in the last 5 minutes.", hasDb),
  ];
  cached = { at: now, checks };
  return checks;
}

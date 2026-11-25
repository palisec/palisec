import "server-only";
import { REASON_CODES } from "@palisec/policy-schema";
import { createHash } from "node:crypto";
import { createPublicClient, getAddress, type Address } from "viem";
import { readAccount, REGISTRY_ADDRESSES } from "policy-enforced-accounts";
import { PUBLIC_DEMO_ACCOUNTS, PUBLIC_DEMO_CHAIN, demoLabel } from "@/lib/public-demo-accounts";
import { NETWORKS } from "@/lib/networks";
import { chainTransport } from "./config";
import { db } from "./db";
import { logEvent } from "./http";
import { ASSETS } from "./valuation";

/**
 * Public data for the site: counts across all organizations (never anything identifying) and decisions of the
 * public demo accounts only. Each result keeps the last good value in memory, so a failing source answers with
 * that value and `stale: true` instead of an error.
 */

/** Totals under this are hidden (null): the site never shows a tiny or zero number. */
const MIN_SHOWN = 10;

type Stamped<T> = T & { as_of: string; stale: boolean };
const lastGood = new Map<string, { at: number; value: unknown }>();

async function remembered<T extends object>(key: string, maxAgeMs: number, load: () => Promise<T>): Promise<Stamped<T> | null> {
  const prev = lastGood.get(key);
  if (prev && Date.now() - prev.at < maxAgeMs) return { ...(prev.value as T), as_of: new Date(prev.at).toISOString(), stale: false };
  try {
    const value = await load();
    lastGood.set(key, { at: Date.now(), value });
    return { ...value, as_of: new Date().toISOString(), stale: false };
  } catch (e) {
    logEvent("warn", "public_data.unavailable", { key, error: e instanceof Error ? e.message.slice(0, 160) : "error" });
    if (!prev) return null;
    return { ...(prev.value as T), as_of: new Date(prev.at).toISOString(), stale: true };
  }
}

const shown = (n: unknown): number | null => {
  const v = Number(n ?? 0);
  return Number.isFinite(v) && v >= MIN_SHOWN ? v : null;
};

export interface Facts {
  decisions_24h: number | null;
  allowed_24h: number | null;
  blocked_24h: number | null;
  held_24h: number | null;
  smart_accounts_mainnet: number | null;
  registry_version: string;
}

export function publicFacts() {
  return remembered<Facts>("facts", 5 * 60_000, async () => {
    const sql = db();
    const [d] = await sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE decision = 'ALLOW')::int AS allowed,
             count(*) FILTER (WHERE decision = 'DENY')::int AS blocked,
             count(*) FILTER (WHERE decision = 'REQUIRES_HUMAN_SIGNATURE')::int AS held,
             (SELECT count(DISTINCT account)::int FROM operations WHERE chain_id = 4663 AND transaction_hash IS NOT NULL) AS accounts
      FROM operations WHERE created_at > now() - interval '24 hours'`;
    return {
      decisions_24h: shown(d.total),
      allowed_24h: shown(d.allowed),
      blocked_24h: shown(d.blocked),
      held_24h: shown(d.held),
      smart_accounts_mainnet: shown(d.accounts),
      registry_version: "v3",
    };
  });
}

export type PublicResult = "allowed" | "held" | "blocked";
export interface ProofRow {
  time: string;
  account: string;
  account_label: string;
  action: string;
  usd: number | null;
  result: PublicResult;
  reason_code: string | null;
  reason: string | null;
  decision_id: string | null;
  tx_hash: string | null;
  receipt_url: string | null;
}

const SYMBOLS = new Map<string, string>(ASSETS[PUBLIC_DEMO_CHAIN as keyof typeof ASSETS]?.map((a) => [a.contract.toLowerCase(), a.symbol]) ?? []);

/** A short readable action from the call: "Swap USDG → NVDA", "Transfer USDG", "Send ETH". */
export function describeAction(target: string, data: string, valueWei: string | number | bigint): string {
  const sel = (data ?? "0x").slice(0, 10).toLowerCase();
  const tgt = SYMBOLS.get(target.toLowerCase());
  if (sel === "0xa9059cbb") return `Transfer ${tgt ?? "token"}`;
  if (sel === "0x095ea7b3") return `Approve ${tgt ?? "token"}`;
  const words = (data ?? "").slice(10).match(/.{64}/g) ?? [];
  const tokens: string[] = [];
  for (const w of words) {
    if (!w.startsWith("000000000000000000000000")) continue;
    const s = SYMBOLS.get(`0x${w.slice(24)}`);
    if (s && tokens[tokens.length - 1] !== s) tokens.push(s);
    if (tokens.length === 2) break;
  }
  const value = BigInt(valueWei ?? 0);
  if (tokens.length === 2) return `Swap ${tokens[0]} → ${tokens[1]}`;
  if (value > 0n && tokens.length === 1) return `Swap ETH → ${tokens[0]}`;
  if (value > 0n && (!data || data === "0x")) return "Send ETH";
  return "Contract call";
}

const RESULT: Record<string, PublicResult> = { ALLOW: "allowed", DENY: "blocked", REQUIRES_HUMAN_SIGNATURE: "held" };
const FILTER: Record<string, string | null> = { all: null, allowed: "ALLOW", held: "REQUIRES_HUMAN_SIGNATURE", blocked: "DENY" };

export interface ProofPage {
  rows: ProofRow[];
  total: number;
  page: number;
  limit: number;
}

export function publicProof(opts: { limit: number; page: number; result: string }) {
  const limit = Math.max(1, Math.min(50, Math.floor(opts.limit) || 25));
  const page = Math.max(1, Math.min(200, Math.floor(opts.page) || 1));
  const decision = FILTER[opts.result] ?? null;
  const accounts = PUBLIC_DEMO_ACCOUNTS.map((d) => d.account.toLowerCase());
  return remembered<ProofPage>(`proof:${limit}:${page}:${opts.result}`, 5 * 60_000, async () => {
    const sql = db();
    const offset = (page - 1) * limit;
    const rows = await sql`
      SELECT created_at, account, target, data, value_wei, usd_micros, decision, reason_code, authorization_id, transaction_hash
      FROM operations
      WHERE chain_id = ${PUBLIC_DEMO_CHAIN} AND lower(account) = ANY(${accounts})
        AND (${decision}::text IS NULL OR decision = ${decision})
      ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM operations
      WHERE chain_id = ${PUBLIC_DEMO_CHAIN} AND lower(account) = ANY(${accounts})
        AND (${decision}::text IS NULL OR decision = ${decision})`;
    const explorer = NETWORKS[PUBLIC_DEMO_CHAIN as keyof typeof NETWORKS].explorer;
    return {
      total: Number(n),
      page,
      limit,
      rows: rows.map((r): ProofRow => {
        const code = (r.reason_code as string | null) ?? null;
        const tx = (r.transaction_hash as string | null) ?? null;
        return {
          time: new Date(r.created_at as string).toISOString(),
          account: getAddress(r.account as string),
          account_label: demoLabel(r.account as string) ?? "demo",
          action: describeAction(r.target as string, r.data as string, r.value_wei as string),
          usd: r.usd_micros != null && Number(r.usd_micros) > 0 ? Math.round(Number(r.usd_micros) / 10_000) / 100 : null,
          result: RESULT[r.decision as string] ?? "blocked",
          reason_code: code,
          reason: code && code in REASON_CODES ? REASON_CODES[code as keyof typeof REASON_CODES] : null,
          // A derived reference, never the authorization itself: an unspent authorization must not be public.
          decision_id: r.authorization_id ? `dec_${createHash("sha256").update(String(r.authorization_id)).digest("hex").slice(0, 16)}` : null,
          tx_hash: tx,
          receipt_url: tx ? `${explorer}/tx/${tx}` : null,
        };
      }),
    };
  });
}

export interface RegistryRow {
  account: string;
  label: string;
  policy_hash: string | null;
  version: number | null;
  stopped: boolean;
  stop_held_by_account: boolean;
  registry: string;
}

export function publicRegistry() {
  return remembered<{ accounts: RegistryRow[] }>("registry", 5 * 60_000, async () => {
    const registry = REGISTRY_ADDRESSES[PUBLIC_DEMO_CHAIN] as Address;
    const client = createPublicClient({ transport: chainTransport(PUBLIC_DEMO_CHAIN, 6000) });
    const accounts = await Promise.all(
      PUBLIC_DEMO_ACCOUNTS.map(async (d): Promise<RegistryRow> => {
        const s = await readAccount(client as never, d.account as Address, registry);
        return {
          account: d.account,
          label: d.label,
          policy_hash: s.policy?.policyHash ?? null,
          version: s.policy ? Number(s.policy.version) : null,
          stopped: s.stopped,
          stop_held_by_account: s.stopHeldByAccount,
          registry,
        };
      }),
    );
    return { accounts };
  });
}

import "server-only";
import { createPublicClient, getAddress, isAddress, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { BILLING, LIMITS, TOKEN, type PlanLimits } from "@/lib/billing-config";
import { MAINNET } from "@/lib/networks";
import type { AgentContext, MemberContext } from "./access";
import { chainEnabled, chainTransport } from "./config";
import { db } from "./db";
import { HttpError, logEvent } from "./http";

/**
 * Phase 5 billing: metering of mainnet decisions, prepaid credits bought on chain, and Pro by holdings.
 * Settings come from `lib/billing-config.ts`; deployment values and test overrides from the environment.
 */
const env = (k: string) => (process.env[k] ?? "").trim();
const intEnv = (k: string, d: number) => (/^\d+$/.test(env(k)) ? Number(env(k)) : d);

export function billingSettings() {
  const contract = env("PALISEC_CREDITS_ADDRESS");
  return {
    /** "off" switches metering off (no decision is refused for credits). */
    metering: !["off", "false", "0"].includes(env("PALISEC_BILLING").toLowerCase()),
    freeDecisions: intEnv("BILLING_FREE_DECISIONS", BILLING.freeDecisionsPerMonth),
    contract: isAddress(contract) ? getAddress(contract) : null,
    deployBlock: BigInt(intEnv("PALISEC_CREDITS_DEPLOY_BLOCK", 0)),
    confirmations: BigInt(intEnv("BILLING_CONFIRMATIONS", 20)),
    palisec: (isAddress(env("PALISEC_TOKEN_ADDRESS")) ? env("PALISEC_TOKEN_ADDRESS") : TOKEN.palisec) as Address,
    proHolding: /^\d+$/.test(env("PRO_HOLDING_WEI")) ? BigInt(env("PRO_HOLDING_WEI")) : BILLING.proHoldingTokens,
  };
}

const month = () => new Date().toISOString().slice(0, 7);

export interface Meter {
  source: "free" | "credit" | "none";
  used: number;
  free: number;
  credits: number;
  month: string;
}

/**
 * Meters one mainnet decision before it is evaluated. Testnet, dry runs and a switched-off meter are free.
 * With no allowance and no credits the request is refused: 402 PS_CREDIT_001, nothing evaluated or recorded
 * (fail closed: without an authorization a PALISEC smart account cannot move anything).
 */
export async function meterDecision(agent: AgentContext, ref: string): Promise<Meter | null> {
  const s = billingSettings();
  if (!s.metering || agent.chainId !== MAINNET) return null;
  const m = month();
  const [{ r }] = await db()`SELECT ps_meter_decision(${agent.orgId}::uuid, ${m}, ${s.freeDecisions}::int, ${ref.slice(0, 200)}) AS r`;
  const meter: Meter = { ...(r as Omit<Meter, "month">), month: m };
  if (meter.source === "none") {
    logEvent("info", "billing.refused", { org_id: agent.orgId });
    throw new HttpError(
      402,
      "PS_CREDIT_001",
      `Decision credits exhausted: the ${meter.free} free mainnet decisions for ${m} are used and no prepaid credits are left. Buy credits in the console (Billing). Testnet and dry runs stay free.`,
    );
  }
  return meter;
}

/** Gives the unit back when no decision was recorded (idempotent replay, refused request, error). */
export async function unmeterDecision(agent: AgentContext, meter: Meter | null, ref: string) {
  if (!meter) return;
  await db()`SELECT ps_unmeter_decision(${agent.orgId}::uuid, ${meter.month}, ${meter.source}, ${ref.slice(0, 200)})`;
}

/** `X-Palisec-Usage` and, at 80% and 95% of the allowance or with few credits left, `X-Palisec-Usage-Warning`. */
export function usageHeaders(meter: Meter | null): Record<string, string> {
  if (!meter) return {};
  const h: Record<string, string> = { "X-Palisec-Usage": `free=${Math.min(meter.used, meter.free)}/${meter.free}; credits=${meter.credits}; month=${meter.month}` };
  const w = usageWarning(meter.used, meter.free, meter.credits);
  if (w) h["X-Palisec-Usage-Warning"] = w;
  return h;
}

export function usageWarning(used: number, free: number, credits: number): string | null {
  if (used < free) {
    const share = used / free;
    const at = [...BILLING.warnAt].reverse().find((t) => share >= t);
    return at ? `${Math.round(at * 100)}% of the free mainnet decisions used this month` : null;
  }
  if (credits === 0) return "Free decisions used and no credits left: further mainnet decisions are refused";
  if (credits <= free * (1 - BILLING.warnAt[0])) return `${credits} credits left`;
  return null;
}

/* ───────── Purchases: CreditsPurchased events → ledger, once each ───────── */

const PURCHASED = parseAbiItem(
  "event CreditsPurchased(bytes32 indexed account, address indexed payer, uint8 indexed asset, uint256 amountPaid, uint256 usdValueE6, uint256 credits, uint256 burned)",
);
const ASSETS = ["USDG", "ETH", "PALISEC"] as const;
const SCAN_CHUNK = 500_000n;

const mainnetClient = () => createPublicClient({ transport: chainTransport(MAINNET) });

/**
 * Reads purchase events since the last scan, up to `confirmations` blocks behind the head (so a reorged
 * event is never credited), and credits each one exactly once. On demand (no timers); concurrent scans
 * are harmless because a purchase is unique per (chain, tx, log).
 */
export async function syncPurchases(maxChunks = 8): Promise<{ scannedTo: bigint | null; credited: number }> {
  const s = billingSettings();
  if (!s.contract || !chainEnabled(MAINNET)) return { scannedTo: null, credited: 0 };
  const key = `credits:${MAINNET}:${s.contract.toLowerCase()}`;
  const c = mainnetClient();
  const [state] = await db()`SELECT last_block::text AS last FROM chain_scan_state WHERE key = ${key}`;
  let from = state ? BigInt(state.last) + 1n : s.deployBlock;
  const safeHead = (await c.getBlockNumber()) - s.confirmations;
  let credited = 0;
  for (let i = 0; i < maxChunks && from <= safeHead; i++) {
    const to = from + SCAN_CHUNK - 1n < safeHead ? from + SCAN_CHUNK - 1n : safeHead;
    const logs = await c.getLogs({ address: s.contract, event: PURCHASED, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const a = l.args;
      const org = await db()`SELECT ps_credit_purchase(${JSON.stringify({
        account: (a.account as string).toLowerCase(),
        chain_id: MAINNET,
        tx_hash: (l.transactionHash as string).toLowerCase(),
        log_index: Number(l.logIndex),
        asset: ASSETS[Number(a.asset)] ?? "USDG",
        amount_paid: String(a.amountPaid),
        usd_micros: String(a.usdValueE6),
        credits: String(a.credits),
        burned: String(a.burned),
        payer: (a.payer as string).toLowerCase(),
        block_number: String(l.blockNumber),
      })}::text::jsonb) AS org`;
      if (org[0]?.org) credited++;
    }
    await db()`
      INSERT INTO chain_scan_state (key, last_block) VALUES (${key}, ${to.toString()}::bigint)
      ON CONFLICT (key) DO UPDATE SET last_block = greatest(chain_scan_state.last_block, excluded.last_block), updated_at = now()`;
    from = to + 1n;
  }
  return { scannedTo: from - 1n, credited };
}

/* ───────── Pro by holdings ───────── */

const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/**
 * Pro when an owner wallet of the organization holds at least the Pro amount of $PALISEC. Read from the
 * chain at sign-in and at most every `proCheckSeconds` while the console is used; nothing is locked or sent.
 * A failed read keeps the previous answer; an answer older than a day counts as not Pro.
 */
export async function refreshPro(orgId: string, force = false): Promise<void> {
  if (!chainEnabled(MAINNET)) return;
  const [row] = await db()`
    INSERT INTO billing_accounts (org_id) VALUES (${orgId}::uuid) ON CONFLICT (org_id) DO UPDATE SET org_id = excluded.org_id
    RETURNING extract(epoch FROM pro_checked_at)::bigint AS checked`;
  if (!force && row.checked && Date.now() / 1000 - Number(row.checked) < intEnv("BILLING_PRO_CHECK_SECONDS", BILLING.proCheckSeconds)) return;
  const owners = await db()`
    SELECT u.address FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ${orgId}::uuid AND m.role = 'owner'`;
  const s = billingSettings();
  try {
    const c = mainnetClient();
    const balances = await Promise.all(owners.map((o) => c.readContract({ address: s.palisec, abi: balanceAbi, functionName: "balanceOf", args: [o.address as Address] })));
    const best = balances.reduce((m, b) => (b > m ? b : m), 0n);
    await db()`UPDATE billing_accounts SET pro = ${best >= s.proHolding}, pro_balance = ${best.toString()}::numeric, pro_checked_at = now() WHERE org_id = ${orgId}::uuid`;
  } catch (e) {
    logEvent("warn", "billing.pro_check_failed", { error: e instanceof Error ? e.message.slice(0, 120) : "error" });
  }
}

/** The organization's limits: Pro only with a check from the last day. */
export async function planLimits(orgId: string): Promise<{ pro: boolean; limits: PlanLimits }> {
  const [r] = await db()`SELECT pro AND pro_checked_at > now() - interval '1 day' AS pro FROM billing_accounts WHERE org_id = ${orgId}::uuid`;
  const pro = Boolean(r?.pro);
  return { pro, limits: pro ? LIMITS.pro : LIMITS.normal };
}

export const planLimitError = (what: string, limit: number) =>
  new HttpError(403, "PS_PLAN_001", `This organization's plan allows ${limit} ${what}. Pro raises the limit: hold ${(Number(BILLING.proHoldingTokens / 10n ** 18n)).toLocaleString("en-US")} $PALISEC in an owner wallet.`);

/** Counts one PALISEC Agent request against the plan's daily limit; refuses past it. */
export async function countAgentRequest(orgId: string) {
  const { limits } = await planLimits(orgId);
  const [{ ok }] = await db()`SELECT ps_count_agent_request(${orgId}::uuid, ${limits.agentRequestsPerDay}::int) AS ok`;
  if (!ok) throw new HttpError(429, "PS_PLAN_001", `This organization's plan allows ${limits.agentRequestsPerDay} PALISEC Agent requests per day (UTC). Direct tools still work.`, true);
}

/* ───────── Console summary ───────── */

export async function billingSummary(ctx: MemberContext) {
  const s = billingSettings();
  let syncError: string | null = null;
  await syncPurchases().catch((e) => {
    syncError = "Purchases could not be read from the chain right now; they are credited on the next check.";
    logEvent("warn", "billing.sync_failed", { error: e instanceof Error ? e.message.slice(0, 160) : "error" });
  });
  await refreshPro(ctx.orgId).catch(() => {});
  const m = month();
  const [acct] = await db()`
    INSERT INTO billing_accounts (org_id) VALUES (${ctx.orgId}::uuid) ON CONFLICT (org_id) DO UPDATE SET org_id = excluded.org_id
    RETURNING purchase_account, credits::text AS credits, month, used_in_month, pro, pro_balance::text AS pro_balance, pro_checked_at`;
  const history = await db()`
    SELECT kind, credits::text AS credits, reason, asset, amount_paid::text AS amount_paid, usd_micros::text AS usd_micros, burned::text AS burned,
           tx_hash, payer, block_number::text AS block_number, created_at
    FROM credit_ledger WHERE org_id = ${ctx.orgId}::uuid AND kind IN ('purchase', 'grant', 'adjustment') ORDER BY created_at DESC LIMIT 50`;
  const used = acct.month === m ? Number(acct.used_in_month) : 0;
  const credits = Number(acct.credits);
  const { pro, limits } = await planLimits(ctx.orgId);
  return {
    month: m,
    metering: s.metering,
    free: s.freeDecisions,
    used,
    credits,
    warning: s.metering ? usageWarning(used, s.freeDecisions, credits) : null,
    purchase_account: acct.purchase_account,
    price: { usd_micros_per_thousand: BILLING.priceUsdE6PerThousand, palisec_discount_bps: BILLING.palisecDiscountBps, packs: BILLING.packs },
    contract: { chain_id: MAINNET, address: s.contract, usdg: TOKEN.usdg, palisec: s.palisec, explorer: TOKEN.explorer },
    sync_error: syncError,
    pro: {
      active: pro,
      balance: acct.pro_balance,
      required: s.proHolding.toString(),
      checked_at: acct.pro_checked_at ? new Date(acct.pro_checked_at).toISOString() : null,
    },
    limits,
    plans: LIMITS,
    history: history.map((h) => ({ ...h, created_at: new Date(h.created_at).toISOString() })),
  };
}

/* ───────── Public burn counter (reads the chain, not the database) ───────── */

export async function burnStats() {
  const s = billingSettings();
  if (!s.contract || !chainEnabled(MAINNET)) return { configured: false as const, total_burned: "0", purchases: 0, rows: [] as BurnRow[] };
  const c = mainnetClient();
  const head = await c.getBlockNumber();
  const rows: BurnRow[] = [];
  let total = 0n;
  // Only the PALISEC asset (topic 3 = 2); the contract is the only source counted.
  for (let from = s.deployBlock; from <= head; from += SCAN_CHUNK * 4n) {
    const to = from + SCAN_CHUNK * 4n - 1n < head ? from + SCAN_CHUNK * 4n - 1n : head;
    const logs = await c.getLogs({ address: s.contract, event: PURCHASED, args: { asset: 2 }, fromBlock: from, toBlock: to });
    for (const l of logs) {
      const burned = l.args.burned as bigint;
      if (burned === 0n) continue;
      total += burned;
      rows.push({ tx_hash: l.transactionHash as Hex, block: String(l.blockNumber), burned: burned.toString(), credits: String(l.args.credits), usd_micros: String(l.args.usdValueE6) });
    }
  }
  return { configured: true as const, contract: s.contract, total_burned: total.toString(), purchases: rows.length, rows: rows.reverse(), checked_at: new Date().toISOString(), explorer: TOKEN.explorer };
}

export interface BurnRow {
  tx_hash: Hex;
  block: string;
  burned: string;
  credits: string;
  usd_micros: string;
}

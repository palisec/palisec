import "server-only";
import { createPublicClient, erc20Abi, type Address } from "viem";
import { summarizeChanges, treasuryLockViolation, type Policy, type PolicyChange, type TreasuryWindow } from "@palisec/policy-schema";
import { chainEnabled, chainTransport } from "./config";
import { db } from "./db";
import { HttpError, logEvent } from "./http";

/**
 * Treasury guard (schema 1.6): the rolling 24-hour sell window for an account, read before evaluation.
 * Sells are what recorded operations still holding (authorized, approved or awaiting approval) sold of
 * the project token through the guard's venues, per account, so switching agents or policies cannot reset
 * the window. Holdings at the window's start are the balance now plus the window's sells, so each sell
 * does not shrink a percentage cap. Anything unreadable returns null, and the engines fail closed.
 */
export const treasuryOn = (p: Policy | null) => p?.treasury_guard?.enabled === true;

export async function treasuryWindow(chainId: number, account: Address, policy: Policy): Promise<TreasuryWindow | null> {
  const g = policy.treasury_guard;
  if (!g?.enabled || !chainEnabled(chainId)) return null;
  try {
    const client = createPublicClient({ transport: chainTransport(chainId) });
    const [balance, [row]] = await Promise.all([
      client.readContract({ address: g.project_token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      db()`SELECT coalesce(sum(treasury_sold), 0)::text AS sold, extract(epoch FROM now())::bigint AS now FROM operations
        WHERE chain_id = ${chainId} AND lower(account) = ${account.toLowerCase()}
          AND created_at > now() - interval '24 hours' AND ps_holds_budget(state, expires_at)`,
    ]);
    const sold = BigInt(row.sold);
    return { observed_at: Number(row.now), sold_24h: sold.toString(), holdings_at_window_start: (balance + sold).toString() };
  } catch (e) {
    logEvent("warn", "treasury.window_unavailable", { chain_id: chainId, message: e instanceof Error ? e.message.slice(0, 160) : "error" });
    return null;
  }
}

/** The cap the database rechecks atomically, base units; null when no cap is set. */
export function treasuryCapFor(policy: Policy | null, window: TreasuryWindow | null | undefined): string | null {
  const cap = policy?.treasury_guard?.enabled ? policy.treasury_guard.daily_sell_cap : null;
  if (!cap || (cap.amount === null && cap.pct_of_holdings_bps === null)) return null;
  let c: bigint | null = cap.amount === null ? null : BigInt(cap.amount);
  if (cap.pct_of_holdings_bps !== null) {
    if (!window) return "0";
    const p = (BigInt(window.holdings_at_window_start) * BigInt(cap.pct_of_holdings_bps)) / 10000n;
    c = c === null || p < c ? p : c;
  }
  return c === null ? null : c.toString();
}

/**
 * Treasury guard lock (PS_TREASURY_005), for every path that changes what an account's agents run under:
 * activation, a holder vote, and binding an agent to a policy. A change that loosens a locked guard is
 * rejected, never queued. The lock holds per account: every policy an agent on the account runs under
 * must keep every locked guard on that account, so a second agent or policy cannot route around it.
 */
export function lockError(changes: PolicyChange[], until: number): HttpError {
  return new HttpError(422, "PS_TREASURY_005", `The treasury guard is locked until ${new Date(until * 1000).toISOString().replace(".000Z", "Z")}; loosening is rejected: ${summarizeChanges(changes)}`);
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** The policy may replace `before` without loosening its locked guard. */
export function assertLockKept(before: Policy | null, after: Policy | null) {
  const v = treasuryLockViolation(before, after, nowSeconds());
  if (v) throw lockError(v, before!.treasury_guard!.locked_until);
}

/**
 * Policies the agents on an account run under today (active versions), and the ones they would run under
 * once a pending change applies (a delayed activation or an agent moving to another policy), so a change
 * queued before a lock cannot take effect around it.
 */
async function accountDocuments(orgId: string, chainId: number, account: string) {
  return (await db()`
    WITH bound AS (
      SELECT a.id, a.policy_id FROM agents a
      WHERE a.org_id = ${orgId}::uuid AND a.chain_id = ${chainId}::int AND lower(a.account) = lower(${account}) AND a.status <> 'revoked')
    SELECT 'active' AS src, p.id AS policy_id, pv.document FROM bound b
      JOIN policies p ON p.id = b.policy_id AND p.disabled_at IS NULL
      JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    UNION ALL
    SELECT 'pending', pc.policy_id, pv.document FROM pending_changes pc
      JOIN policy_versions pv ON pv.policy_id = pc.policy_id AND pv.version = pc.policy_version
    WHERE pc.org_id = ${orgId}::uuid AND pc.state = 'pending' AND pc.kind = 'policy_activation' AND pc.policy_id IN (SELECT policy_id FROM bound)
    UNION ALL
    SELECT 'pending', p.id, pv.document FROM pending_changes pc
      JOIN bound b ON b.id = pc.agent_id
      JOIN policies p ON p.id = (pc.setting->>'policy_id')::uuid AND p.disabled_at IS NULL
      JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE pc.org_id = ${orgId}::uuid AND pc.state = 'pending' AND pc.kind = 'agent_rebind'`) as { src: string; policy_id: string; document: Policy }[];
}

/** `target` keeps the locked guard of `locked`: only its treasury section is compared. */
function keeps(locked: Policy, target: Policy, now: number) {
  const g = locked.treasury_guard;
  if (!g?.enabled || !(g.locked_until > now)) return null;
  const merged: Policy = { ...locked };
  if (target.treasury_guard) merged.treasury_guard = target.treasury_guard;
  else delete merged.treasury_guard;
  return treasuryLockViolation(locked, merged, now);
}

/**
 * The account's agents, after this change, all run under policies that keep every locked guard on the account.
 * `replace` swaps one policy's document (an activation); `bind` adds a policy an agent would move onto.
 */
export async function assertAccountGuards(orgId: string, chainId: number, account: string, opts: { replace?: { policyId: string; document: Policy }; bind?: Policy | null }) {
  const now = nowSeconds();
  const docs = (await accountDocuments(orgId, chainId, account)).map((r) => (opts.replace && r.src === "active" && r.policy_id === opts.replace.policyId ? opts.replace.document : r.document));
  const all = opts.bind ? [...docs, opts.bind] : docs;
  for (const locked of all)
    for (const target of all) {
      if (locked === target) continue;
      const v = keeps(locked, target, now);
      if (v) throw lockError(v, locked.treasury_guard!.locked_until);
    }
}

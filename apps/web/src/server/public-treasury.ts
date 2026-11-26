import "server-only";
import { REASON_CODES, treasuryCap, type Policy, type TreasuryGuard } from "@palisec/policy-schema";
import { createPublicClient, erc20Abi, getAddress, isAddress, parseAbi, type Address } from "viem";
import { readAccount, REGISTRY_ADDRESSES, type ReceiptJson } from "policy-enforced-accounts";
import { NETWORKS } from "@/lib/networks";
import { chainTransport } from "./config";
import { db } from "./db";
import { HttpError, logEvent } from "./http";
import { describeAction } from "./public-data";
import { signReceipt } from "./peaa";

/**
 * The public page of a protected agent's treasury: the rules and the lock read from the policy that decides
 * today, the sells against the cap, every blocked attempt and every allowed sell, the account's on-chain
 * policy commitment, and who holds the keys that could sign without Palisec. Only accounts whose deciding
 * policy has an enabled treasury guard are public; nothing else about the organization is shown.
 */

const CHAIN = 4663;
const COSIGNER = "0x628fda166280b9e2c5e5fbd89fdddace626d8ec7";
const SAFE = parseAbi(["function getOwners() view returns (address[])", "function getThreshold() view returns (uint256)"]);
const TIMELOCK = parseAbi(["function getMinDelay() view returns (uint256)"]);

export type RecoveryState = "team_key" | "timelock" | "contract" | "not_enforced" | "unknown";

export interface RecoveryOwner {
  /** fully bound: the only way past Palisec is a timelock whose delay outlasts the lock. */
  state: RecoveryState;
  owners: { address: string; role: "palisec" | "key" | "contract"; min_delay_seconds: number | null }[];
  threshold: number | null;
  explanation: string;
}

export interface TreasuryEvent {
  time: string;
  action: string;
  result: "allowed" | "blocked";
  reason_code: string | null;
  reason: string | null;
  sold: string | null;
  decision_id: string;
  tx_url: string | null;
  receipt_url: string | null;
}

export interface PublicTreasury {
  account: string;
  chain_id: number;
  guard: TreasuryGuard;
  policy_version: number;
  commitment: { policy_hash: string; version: string; policy_uri: string; registry: string } | null;
  sold_24h: string;
  cap: string | null;
  holdings: string | null;
  recovery: RecoveryOwner;
  events: TreasuryEvent[];
  explorer: string;
  as_of: string;
}

/** The deciding policy of an agent on the account with an enabled treasury guard, or null. */
async function guardedPolicy(account: string) {
  const [r] = await db()`
    SELECT p.id AS policy_id, pv.version, pv.document FROM agents a
      JOIN policies p ON p.id = a.policy_id AND p.disabled_at IS NULL
      JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE a.chain_id = ${CHAIN} AND lower(a.account) = ${account.toLowerCase()} AND a.status <> 'revoked'
      AND pv.document->'treasury_guard'->>'enabled' = 'true'
    ORDER BY (pv.document->'treasury_guard'->>'locked_until')::bigint DESC LIMIT 1`;
  return r ? { policyId: String(r.policy_id), version: Number(r.version), document: r.document as Policy } : null;
}

/**
 * Who could sign without Palisec. A Palisec account is a Safe with three owners and a threshold of two: the
 * agent's key, the Palisec co-signer and a recovery owner. The two non-Palisec owners together can sign
 * alone, so the rules bind the team only when one of them is a contract the team cannot use at once: a
 * timelock whose minimum delay outlasts the treasury lock.
 */
export async function recoveryOwner(account: Address, lockedUntil: number): Promise<RecoveryOwner> {
  const client = createPublicClient({ transport: chainTransport(CHAIN) });
  try {
    const [owners, threshold] = await Promise.all([
      client.readContract({ address: account, abi: SAFE, functionName: "getOwners" }),
      client.readContract({ address: account, abi: SAFE, functionName: "getThreshold" }),
    ]);
    const rows = await Promise.all(
      owners.map(async (o) => {
        if (o.toLowerCase() === COSIGNER) return { address: getAddress(o), role: "palisec" as const, min_delay_seconds: null };
        const code = await client.getCode({ address: o });
        if (!code || code === "0x") return { address: getAddress(o), role: "key" as const, min_delay_seconds: null };
        const delay = await client.readContract({ address: o, abi: TIMELOCK, functionName: "getMinDelay" }).then(Number).catch(() => null);
        return { address: getAddress(o), role: "contract" as const, min_delay_seconds: delay };
      }),
    );
    const t = Number(threshold);
    const hasPalisec = rows.some((r) => r.role === "palisec");
    if (!hasPalisec || rows.length !== 3 || t !== 2)
      return { state: "not_enforced", owners: rows, threshold: t, explanation: "The account's owners or threshold let it sign without Palisec, so these rules are not enforced on chain." };
    const others = rows.filter((r) => r.role !== "palisec");
    const remaining = Math.max(0, lockedUntil - Math.floor(Date.now() / 1000));
    const timelock = others.find((r) => r.role === "contract" && r.min_delay_seconds !== null && r.min_delay_seconds >= remaining);
    if (timelock)
      return { state: "timelock", owners: rows, threshold: t, explanation: `Fully bound: the only way to sign without Palisec goes through a timelock (${timelock.address}) whose ${Math.round((timelock.min_delay_seconds ?? 0) / 86400)}-day delay outlasts the lock, so any attempt is public on chain long before it can run.` };
    if (others.some((r) => r.role === "contract"))
      return { state: "contract", owners: rows, threshold: t, explanation: "One owner is a contract that is not a timelock with a long enough delay. Check what that contract allows before relying on these rules." };
    return { state: "team_key", owners: rows, threshold: t, explanation: "The agent's key and the recovery owner's key are both ordinary keys, and together they can sign without Palisec." };
  } catch (e) {
    logEvent("warn", "treasury.owners_unavailable", { message: e instanceof Error ? e.message.slice(0, 160) : "error" });
    return { state: "unknown", owners: [], threshold: null, explanation: "The account's owners could not be read right now." };
  }
}

export async function publicTreasury(accountParam: string): Promise<PublicTreasury> {
  if (!isAddress(accountParam)) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  const account = getAddress(accountParam);
  const p = await guardedPolicy(account);
  if (!p) throw new HttpError(404, "PS_REQUEST_001", "No treasury guard on this account");
  const guard = p.document.treasury_guard!;
  const client = createPublicClient({ transport: chainTransport(CHAIN) });
  const registry = REGISTRY_ADDRESSES[CHAIN]!;
  const explorer = NETWORKS[CHAIN as keyof typeof NETWORKS].explorer;
  const [ops, [win], balance, onChain, recovery] = await Promise.all([
    db()`
      SELECT id, created_at, target, data, value_wei, decision, reason_code, treasury_sold, transaction_hash
      FROM operations WHERE chain_id = ${CHAIN} AND lower(account) = ${account.toLowerCase()}
        AND (reason_code LIKE 'PS_TREASURY_%' OR treasury_sold > 0)
      ORDER BY created_at DESC LIMIT 50`,
    db()`
      SELECT coalesce(sum(treasury_sold), 0)::text AS sold FROM operations
      WHERE chain_id = ${CHAIN} AND lower(account) = ${account.toLowerCase()}
        AND created_at > now() - interval '24 hours' AND ps_holds_budget(state, expires_at)`,
    client.readContract({ address: guard.project_token, abi: erc20Abi, functionName: "balanceOf", args: [account] }).catch(() => null),
    readAccount(client as never, account, registry).catch(() => null),
    recoveryOwner(account, guard.locked_until),
  ]);
  const sold = BigInt(win.sold);
  const holdings = balance === null ? null : balance + sold;
  const cap = holdings === null && guard.daily_sell_cap.pct_of_holdings_bps !== null ? null : treasuryCap(guard.daily_sell_cap, holdings ?? 0n);
  return {
    account,
    chain_id: CHAIN,
    guard,
    policy_version: p.version,
    commitment: onChain?.policy
      ? { policy_hash: onChain.policy.policyHash, version: onChain.policy.version.toString(), policy_uri: onChain.policy.policyURI, registry }
      : null,
    sold_24h: sold.toString(),
    cap: cap === null ? null : cap.toString(),
    holdings: holdings === null ? null : holdings.toString(),
    recovery,
    explorer,
    as_of: new Date().toISOString(),
    events: ops.map((r): TreasuryEvent => {
      const code = (r.reason_code as string | null) ?? null;
      const tx = (r.transaction_hash as string | null) ?? null;
      const allowed = r.decision !== "DENY";
      return {
        time: new Date(r.created_at as string).toISOString(),
        action: describeAction(r.target as string, r.data as string, r.value_wei as string),
        result: allowed ? "allowed" : "blocked",
        reason_code: code,
        reason: code && code in REASON_CODES ? REASON_CODES[code as keyof typeof REASON_CODES] : null,
        sold: Number(r.treasury_sold) > 0 ? String(r.treasury_sold) : null,
        decision_id: String(r.id),
        tx_url: tx ? `${explorer}/tx/${tx}` : null,
        receipt_url: `/api/v1/public/treasury/${account}/receipts/${r.id}`,
      };
    }),
  };
}

/**
 * The signed decision receipt (ERC-8511) of one decision on a guarded account, signed again from the
 * recorded operation and the policy version that decided it, with the decision's own time.
 */
export async function publicTreasuryReceipt(accountParam: string, operationId: string): Promise<ReceiptJson> {
  if (!isAddress(accountParam) || !/^[0-9a-f-]{36}$/i.test(operationId)) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  const account = getAddress(accountParam);
  if (!(await guardedPolicy(account))) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  const [r] = await db()`
    SELECT o.id, o.created_at, o.expires_at, o.target, o.data, o.value_wei, o.decision, o.reason_code, o.policy_version, pv.document
    FROM operations o LEFT JOIN policy_versions pv ON pv.policy_id = o.policy_id AND pv.version = o.policy_version
    WHERE o.id = ${operationId}::uuid AND o.chain_id = ${CHAIN} AND lower(o.account) = ${account.toLowerCase()}
      AND (o.reason_code LIKE 'PS_TREASURY_%' OR o.treasury_sold > 0)`;
  if (!r) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  const receipt = await signReceipt({
    chainId: CHAIN, account, target: r.target, valueWei: String(r.value_wei), data: r.data, decision: r.decision, reasonCode: r.reason_code,
    policy: r.document, policyVersion: r.policy_version, issuedAt: new Date(r.created_at), expiresAt: r.expires_at ? new Date(r.expires_at) : null, decisionId: String(r.id),
  });
  if (!receipt) throw new HttpError(404, "PS_REQUEST_001", "No receipt: the account does not publish to the registry");
  return receipt;
}

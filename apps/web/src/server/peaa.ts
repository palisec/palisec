import "server-only";
import { after } from "next/server";
import { createPublicClient, createWalletClient, getAddress, isAddressEqual, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  PALISEC_REASON_MAP,
  REGISTRY_ABI,
  REGISTRY_ADDRESSES,
  intentHash,
  policyHash,
  readAccount,
  typedReceipt,
  type ReceiptJson,
} from "policy-enforced-accounts";
import { CHAINS, chainTransport, type ChainId } from "./config";
import { db } from "./db";
import { logEvent } from "./http";

/**
 * Policy publishing: the draft ERC "Policy-Enforced Agent Accounts", Palisec's side.
 *  - Receipts: every decision for an opted-in account carries an EIP-712 receipt signed by the receipt
 *    key (PEAA_RECEIPT_KEY), never by the co-signer. Additive field; nothing about the decision changes.
 *  - Commitments: a sync compares each opted-in account's authoritative state (active policy, pending
 *    loosening, stop) with the registry (v2) and publishes the difference from the publisher key
 *    (PEAA_PUBLISHER_KEY). Idempotent and claimed per account, so a repeat never sends twice. It runs
 *    after policy and stop changes and from the hourly workflow. Decisions never wait for it.
 *  - Time rules of the v2 registry: everything the publisher posts waits the account's minDelay. A new
 *    active policy (a tightening, applied off chain at once) is posted as pending for now + minDelay and
 *    confirmed once due; a Palisec loosening is posted for its own effective time, or later if minDelay
 *    requires. Until then the registry shows the previous policy, and receipts carry the newer version,
 *    which a use-time verifier refuses (fail closed).
 */

export const SCHEMA_URI = "https://palisec.tech/schemas/palisec-policy.json";
export const policyURI = (hash: string) => `https://palisec.tech/api/v1/public/policies/${hash}`;
const RECEIPT_TTL_SECONDS = 300;
/** Margin added to minDelay so a pending entry is never refused as too soon by the time it is mined. */
const PENDING_MARGIN_SECONDS = 120;
/** Palisec's co-signers (public, also on /docs/detect): an account must declare one of these as its policy signer. */
const COSIGNER_ADDRESSES: Record<number, Address> = {
  4663: "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7",
  46630: "0xc4022a43FeFaeB9Ac6d66Cd6B74B1c8044ca8beD",
};

const key = (name: "PEAA_PUBLISHER_KEY" | "PEAA_RECEIPT_KEY"): Hex | null => {
  const v = process.env[name]?.trim();
  return v && /^0x[0-9a-fA-F]{64}$/.test(v) ? (v as Hex) : null;
};
export const registryFor = (chainId: number): Address | null => REGISTRY_ADDRESSES[chainId] ?? null;

// ----------------------------------------------------------------- opt-in cache

let optIn: { at: number; accounts: Set<string> } | null = null;
async function optedIn(chainId: number, account: string): Promise<boolean> {
  if (!registryFor(chainId)) return false;
  if (!optIn || Date.now() - optIn.at > 60_000) {
    const rows = await db()`SELECT a.chain_id, lower(a.account) AS account FROM peaa_accounts p JOIN agents a ON a.id = p.agent_id WHERE a.status <> 'revoked'`;
    optIn = { at: Date.now(), accounts: new Set(rows.map((r) => `${r.chain_id}:${r.account}`)) };
  }
  return optIn.accounts.has(`${chainId}:${account.toLowerCase()}`);
}

// ----------------------------------------------------------------- receipts

export interface ReceiptInput {
  chainId: number;
  account: string;
  target: string;
  valueWei: string;
  data: string;
  decision: "ALLOW" | "DENY" | "REVIEW" | string;
  reasonCode: string | null;
  policy: unknown;
  policyVersion: number | null;
  issuedAt: Date;
  expiresAt: Date | null;
  decisionId: string;
}

/** A signed receipt, or null when the account is not opted in or receipts are not configured. Never throws. */
export async function signReceipt(r: ReceiptInput): Promise<ReceiptJson | null> {
  try {
    const pk = key("PEAA_RECEIPT_KEY");
    const registry = registryFor(r.chainId);
    if (!pk || !registry || !(await optedIn(r.chainId, r.account))) return null;
    const signer = privateKeyToAccount(pk);
    const issuedAt = Math.floor(r.issuedAt.getTime() / 1000);
    const expiresAt = r.expiresAt ? Math.floor(r.expiresAt.getTime() / 1000) : issuedAt + RECEIPT_TTL_SECONDS;
    const decision = r.decision === "ALLOW" ? "ALLOW" : r.decision === "DENY" ? "DENY" : "REVIEW";
    const receipt: ReceiptJson = {
      chainId: String(r.chainId),
      registry,
      account: getAddress(r.account),
      intentHash: intentHash({ chainId: r.chainId, account: getAddress(r.account), target: getAddress(r.target), value: BigInt(r.valueWei), data: r.data as Hex }),
      decision,
      reasonCode: r.reasonCode ? (PALISEC_REASON_MAP[r.reasonCode] ?? "OTHER") : "NONE",
      detailCode: r.reasonCode ? `palisec:${r.reasonCode}` : "NONE",
      policyHash: r.policy ? policyHash(r.policy) : (`0x${"0".repeat(64)}` as Hex),
      policyVersion: String(r.policyVersion ?? 0),
      issuedAt: String(issuedAt),
      expiresAt: String(Math.max(expiresAt, issuedAt)),
      decisionId: keccak256(stringToHex(r.decisionId)),
      signer: signer.address,
      signature: "0x",
    };
    receipt.signature = await signer.signTypedData(typedReceipt(receipt));
    return receipt;
  } catch (e) {
    logEvent("warn", "peaa.receipt_failed", { error: String(e) });
    return null;
  }
}

// ----------------------------------------------------------------- commitments

interface Target {
  agentId: string;
  orgId: string;
  chainId: ChainId;
  account: Address;
  publishPolicy: boolean;
  active: { version: number; document: unknown } | null;
  pending: { version: number; document: unknown; effectiveAt: Date } | null;
  stopped: boolean;
  mandate: { slug: string; config: unknown } | null;
}

async function targets(orgId: string | null): Promise<Target[]> {
  const rows = await db()`
    SELECT p.agent_id, a.org_id, a.chain_id, a.account, p.publish_policy,
      (o.emergency_stop OR a.status <> 'active') AS stopped,
      av.version AS active_version, av.document AS active_document,
      pc.policy_version AS pending_version, pc.effective_at AS pending_effective_at, pv.document AS pending_document,
      m.slug AS mandate_slug, m.rules AS mandate_rules, m.envelope AS mandate_envelope, m.token AS mandate_token
    FROM peaa_accounts p
    JOIN agents a ON a.id = p.agent_id AND a.status <> 'revoked'
    JOIN organizations o ON o.id = a.org_id
    LEFT JOIN policies pol ON pol.id = a.policy_id AND pol.disabled_at IS NULL
    LEFT JOIN policy_versions av ON av.policy_id = pol.id AND av.version = pol.active_version
    LEFT JOIN pending_changes pc ON pc.policy_id = pol.id AND pc.state = 'pending' AND pc.kind = 'policy_activation'
    LEFT JOIN policy_versions pv ON pv.policy_id = pc.policy_id AND pv.version = pc.policy_version
    LEFT JOIN LATERAL (
      SELECT slug, jsonb_build_object('voting_period_seconds', voting_period_seconds, 'quorum', quorum::text, 'pass_bps', pass_bps, 'proposer_min', proposer_min::text) AS rules,
        envelope, token FROM mandates WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1
    ) m ON true
    WHERE ${orgId}::uuid IS NULL OR a.org_id = ${orgId}::uuid`;
  return rows.map((r) => ({
    agentId: r.agent_id,
    orgId: r.org_id,
    chainId: Number(r.chain_id) as ChainId,
    account: getAddress(r.account),
    publishPolicy: r.publish_policy,
    active: r.active_version ? { version: Number(r.active_version), document: r.active_document } : null,
    pending: r.pending_version && r.pending_document ? { version: Number(r.pending_version), document: r.pending_document, effectiveAt: new Date(r.pending_effective_at) } : null,
    stopped: r.stopped,
    mandate: r.mandate_slug ? { slug: r.mandate_slug, config: { slug: r.mandate_slug, token: String(r.mandate_token).toLowerCase(), rules: r.mandate_rules, envelope: r.mandate_envelope } } : null,
  }));
}

export interface SyncResult {
  account: string;
  sent: { kind: string; tx: string }[];
  skipped?: string;
  error?: string;
}

/** Publishes the difference between Palisec's state and the registry for each opted-in account. */
export async function syncCommitments(orgId: string | null = null): Promise<SyncResult[]> {
  const pk = key("PEAA_PUBLISHER_KEY");
  if (!pk) return [];
  const publisher = privateKeyToAccount(pk);
  // Due loosenings are applied lazily elsewhere; apply them now so their confirmation is published.
  const { applyDue } = await import("./pending");
  await applyDue(orgId).catch(() => {});
  const out: SyncResult[] = [];
  for (const t of await targets(orgId)) {
    const registry = registryFor(t.chainId);
    if (!registry || !CHAINS[t.chainId]?.enabled) continue;
    const [claim] = await db()`
      UPDATE peaa_accounts SET syncing_until = now() + interval '2 minutes'
      WHERE agent_id = ${t.agentId}::uuid AND (syncing_until IS NULL OR syncing_until < now()) RETURNING agent_id`;
    if (!claim) {
      out.push({ account: t.account, sent: [], skipped: "another sync is running" });
      continue;
    }
    const res: SyncResult = { account: t.account, sent: [] };
    try {
      await syncOne(t, registry, publisher, res);
      await db()`UPDATE peaa_accounts SET syncing_until = NULL, last_synced_at = now(), last_error = NULL WHERE agent_id = ${t.agentId}::uuid`;
    } catch (e) {
      res.error = String((e as Error).message ?? e).slice(0, 300);
      logEvent("warn", "peaa.sync_failed", { account: t.account, error: res.error });
      await db()`UPDATE peaa_accounts SET syncing_until = NULL, last_error = ${res.error} WHERE agent_id = ${t.agentId}::uuid`;
    }
    out.push(res);
  }
  return out;
}

async function syncOne(t: Target, registry: Address, publisher: ReturnType<typeof privateKeyToAccount>, res: SyncResult) {
  const transport = chainTransport(t.chainId, 10_000);
  const pub = createPublicClient({ transport });
  const wallet = createWalletClient({ account: publisher, transport });
  const chain = { id: t.chainId, name: CHAINS[t.chainId].name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: CHAINS[t.chainId].rpcs } } } as const;
  const onChain = await readAccount(pub as never, t.account, registry);
  // The account itself must have declared Palisec: our co-signer, our publisher. Otherwise publish nothing.
  const cosigner = COSIGNER_ADDRESSES[t.chainId];
  if (!onChain.enforced || !cosigner || !isAddressEqual(onChain.policySigner, cosigner) || !isAddressEqual(onChain.publisher, publisher.address)) {
    res.skipped = "account has not declared Palisec's signers on the registry";
    return;
  }
  const send = async (kind: string, functionName: string, args: readonly unknown[], record: { hash?: string; version?: number; effectiveAt?: Date; document?: unknown }) => {
    const tx = await wallet.writeContract({ chain, address: registry, abi: REGISTRY_ABI, functionName, args } as never);
    // Recorded as soon as it is sent, so an error while waiting can never make a later sync send it again.
    await db()`
      INSERT INTO peaa_commitments (agent_id, chain_id, account, kind, policy_hash, version, effective_at, document, tx_hash, registry)
      VALUES (${t.agentId}::uuid, ${t.chainId}, ${t.account.toLowerCase()}, ${kind}, ${record.hash ?? null}, ${record.version ?? null},
        ${record.effectiveAt ?? null}, ${record.document === undefined ? null : JSON.stringify(record.document)}::text::jsonb, ${tx}, ${registry.toLowerCase()})`;
    res.sent.push({ kind, tx });
    let receipt: Awaited<ReturnType<typeof pub.waitForTransactionReceipt>> | null = null;
    for (let attempt = 0; attempt < 3 && !receipt; attempt++)
      receipt = await pub.waitForTransactionReceipt({ hash: tx, timeout: 30_000, pollingInterval: 1_000 }).catch(() => null);
    if (receipt && receipt.status !== "success") {
      await db()`DELETE FROM peaa_commitments WHERE tx_hash = ${tx}`;
      throw new Error(`${functionName} reverted (${tx})`);
    }
  };
  const uri = (h: string) => (t.publishPolicy ? policyURI(h) : "");
  const nowS = () => Math.floor(Date.now() / 1000);
  const earliest = () => nowS() + onChain.minDelay + PENDING_MARGIN_SECONDS;
  const same = (c: { policyHash: string; version: bigint } | null, h: string, v: number) => !!c && c.policyHash.toLowerCase() === h && Number(c.version) === v;
  let pendingSlot = onChain.pending;

  // 1. Active policy: on chain it waits minDelay (posted as pending), then is confirmed once due.
  if (t.active) {
    const h = policyHash(t.active.document);
    const cur = onChain.policy;
    const ahead = cur && Number(cur.version) > t.active.version;
    if (!ahead && !same(cur, h, t.active.version)) {
      if (!same(pendingSlot, h, t.active.version)) {
        const at = earliest();
        await send("pending", "setPending", [t.account, h, BigInt(t.active.version), BigInt(at), uri(h), SCHEMA_URI], {
          hash: h,
          version: t.active.version,
          effectiveAt: new Date(at * 1000),
          document: t.active.document,
        });
        pendingSlot = { policyHash: h as Hex, version: BigInt(t.active.version), effectiveAt: BigInt(at), policyURI: uri(h), schemaURI: SCHEMA_URI };
      }
      // Not in effect yet on chain: a Palisec loosening waits until this one is (one pending slot).
      return syncStopAndMandate(t, onChain, send);
    }
    if (!ahead) {
      // In effect on chain (possibly by time alone): confirm it once, which settles it and records it here.
      const [done] = await db()`SELECT 1 FROM peaa_commitments WHERE agent_id = ${t.agentId}::uuid AND registry = ${registry.toLowerCase()} AND kind = 'activated' AND policy_hash = ${h} AND version = ${t.active.version}`;
      if (!done) await send("activated", "activate", [t.account, h, BigInt(t.active.version), uri(h), SCHEMA_URI], { hash: h, version: t.active.version, document: t.active.document });
      pendingSlot = (await readAccount(pub as never, t.account, registry)).pending;
    }
  }
  // 2. Pending loosening: posted for its own effective time, or later if minDelay requires.
  if (t.pending && t.pending.effectiveAt.getTime() > Date.now() + 15_000) {
    const h = policyHash(t.pending.document);
    if (!same(pendingSlot, h, t.pending.version)) {
      const at = Math.max(Math.floor(t.pending.effectiveAt.getTime() / 1000), earliest());
      await send("pending", "setPending", [t.account, h, BigInt(t.pending.version), BigInt(at), uri(h), SCHEMA_URI], {
        hash: h,
        version: t.pending.version,
        effectiveAt: new Date(at * 1000),
        document: t.pending.document,
      });
    }
  } else if (!t.pending && pendingSlot) {
    await send("cancelled", "cancelPending", [t.account, "cancelled in Palisec"], { hash: pendingSlot.policyHash.toLowerCase(), version: Number(pendingSlot.version) });
  }
  return syncStopAndMandate(t, onChain, send);
}

type Send = (kind: string, functionName: string, args: readonly unknown[], record: { hash?: string; version?: number; effectiveAt?: Date; document?: unknown }) => Promise<void>;

async function syncStopAndMandate(t: Target, onChain: Awaited<ReturnType<typeof readAccount>>, send: Send) {
  // 3. Emergency stop (organization stop, or the agent paused).
  if (t.stopped !== onChain.stopped)
    await send(t.stopped ? "stop" : "lift", "setStopped", [t.account, t.stopped, t.stopped ? "emergency stop or agent paused in Palisec" : ""], {});
  // 4. Mandate link.
  if (t.mandate) {
    const h = policyHash(t.mandate.config);
    const mandateURI = `https://palisec.tech/m/${t.mandate.slug}`;
    if (!onChain.mandate || onChain.mandate.uri !== mandateURI || onChain.mandate.configHash.toLowerCase() !== h)
      await send("mandate", "setMandate", [t.account, mandateURI, h], { hash: h, document: t.mandate.config });
  }
}

/** Runs a sync for this organization after the response (never delays the request; errors are logged). */
export function queueSync(orgId: string) {
  if (!key("PEAA_PUBLISHER_KEY")) return;
  try {
    after(async () => {
      await syncCommitments(orgId).catch((e) => logEvent("warn", "peaa.sync_failed", { error: String(e) }));
    });
  } catch {
    /* outside a request scope: the hourly sync will publish it */
  }
}

/** A committed document by its hash, only for accounts that publish their policy. */
export async function committedDocument(hash: string): Promise<unknown | null> {
  if (!/^0x[0-9a-f]{64}$/.test(hash)) return null;
  const [r] = await db()`
    SELECT c.document FROM peaa_commitments c JOIN peaa_accounts p ON p.agent_id = c.agent_id
    WHERE c.policy_hash = ${hash} AND c.document IS NOT NULL AND c.kind IN ('activated', 'pending') AND p.publish_policy
    ORDER BY c.created_at DESC LIMIT 1`;
  return r?.document ?? null;
}

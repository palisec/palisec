import "server-only";
import type { UpochStatus } from "@palisec/policy-schema";
import { createPublicClient, getAddress, parseAbi, type Address } from "viem";
import { CHAINS, chainTransport, type ChainId } from "./config";
import { db } from "./db";
import { logEvent } from "./http";
import { MAINNET, TESTNET } from "@/lib/networks";

/*
 * Phase 6.5: read-only Upoch integration. The agent's Upoch workflow is read from Upoch's public ledger
 * contract (addresses from @upoch/sdk's published deployments) before evaluation and passed to both
 * engines as `env.upoch`. Nothing here signs or writes; Upoch never touches PALISEC's signing. Any failed
 * read returns null, which the engines treat as unavailable (deny or human review, never allow).
 */

export const UPOCH_LEDGER: Record<number, Address> = {
  [MAINNET]: "0x6179d9123c3c1f9e82f948101a4350cb55aa8c27",
  [TESTNET]: "0x8b929fc22731ac3285fe98b190423bddd1487361",
};
export const UPOCH_SITE = "https://upoch.tech";

const LEDGER_ABI = parseAbi([
  "function workflowCount() view returns (uint256)",
  "function getWorkflow(uint256) view returns ((address owner,address pendingOwner,uint8 status,(uint8 guardianThreshold,bool ownerApprovalRequired,uint32 ownerFallbackDelay,uint32 timelock,uint32 approvalWindow,uint32 executionWindow) policy,uint64 checkpointCount,uint64 headSequence,bytes32 headHash,uint256 storedActiveProposalId,string metadataURI))",
  "function getGuardians(uint256) view returns (address[])",
  "function getCheckpoint(uint256,uint64) view returns ((bytes32 checkpointHash,bytes32 parentHash,uint64 parentSequence,bytes32 stateHash,bytes32 traceHash,bytes32 dataURIHash,address submitter,uint64 timestamp))",
]);
const SAFE_ABI = parseAbi(["function getOwners() view returns (address[])"]);

export interface UpochDetail extends UpochStatus {
  chain_id: number;
  owner: string | null;
  guardian_addresses: string[];
  head_sequence: number | null;
  url: string | null;
}

function client(chainId: number) {
  const chain = CHAINS[chainId as ChainId];
  if (!chain?.enabled || !UPOCH_LEDGER[chainId]) return null;
  return createPublicClient({ transport: chainTransport(chainId as ChainId, 4000) });
}

/** Parses a stored workflow ID ("" when none). */
export function parseWorkflowId(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (!/^[1-9][0-9]{0,18}$/.test(s)) throw new Error("upoch_workflow_id must be a positive whole number");
  return s;
}

/**
 * The agent's workflow as the engines need it. `linked`: the workflow's owner or one of its guardians is
 * an owner of the agent's account (a Safe) AND a member of the organization. The agent's own key is a Safe
 * owner too but never a member, so a compromised agent key cannot link a workflow it registered itself.
 */
export async function readUpoch(chainId: number, account: string, workflowId: string | null, members: string[]): Promise<UpochDetail | null> {
  const now = Math.floor(Date.now() / 1000);
  const empty: UpochDetail = {
    chain_id: chainId, workflow_id: "", observed_at: now, linked: false, active: false, checkpoint_count: 0,
    last_checkpoint_at: null, guardians: 0, owner: null, guardian_addresses: [], head_sequence: null, url: null,
  };
  if (!workflowId) return empty;
  const c = client(chainId);
  if (!c) return null;
  const ledger = UPOCH_LEDGER[chainId]!;
  try {
    const id = BigInt(workflowId);
    const count = await c.readContract({ address: ledger, abi: LEDGER_ABI, functionName: "workflowCount" });
    if (id > count) return { ...empty, workflow_id: workflowId, url: `${UPOCH_SITE}/app/agents/${workflowId}` };
    const [w, guardians, owners] = await Promise.all([
      c.readContract({ address: ledger, abi: LEDGER_ABI, functionName: "getWorkflow", args: [id] }),
      c.readContract({ address: ledger, abi: LEDGER_ABI, functionName: "getGuardians", args: [id] }),
      c.readContract({ address: getAddress(account), abi: SAFE_ABI, functionName: "getOwners" }).catch(() => [] as readonly Address[]),
    ]);
    const checkpoints = Number(w.checkpointCount);
    const head = checkpoints > 0 ? await c.readContract({ address: ledger, abi: LEDGER_ABI, functionName: "getCheckpoint", args: [id, w.headSequence] }) : null;
    const accountOwners = owners.map((o) => getAddress(o));
    const trusted = members.map((m) => getAddress(m)).filter((m) => accountOwners.includes(m));
    const linked = [w.owner, ...guardians].some((a) => trusted.includes(getAddress(a)));
    return {
      chain_id: chainId,
      workflow_id: workflowId,
      observed_at: Math.floor(Date.now() / 1000),
      linked,
      active: w.status === 0,
      checkpoint_count: checkpoints,
      last_checkpoint_at: head ? Number(head.timestamp) : null,
      guardians: guardians.length,
      owner: getAddress(w.owner),
      guardian_addresses: guardians.map((g) => getAddress(g)),
      head_sequence: checkpoints > 0 ? Number(w.headSequence) : null,
      url: `${UPOCH_SITE}/app/agents/${workflowId}`,
    };
  } catch (e) {
    // No URLs in logs: an RPC URL can carry a provider key.
    const message = (e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e)).replace(/https?:\/\/\S+/g, "[rpc]").slice(0, 200);
    logEvent("warn", "upoch.unavailable", { chain_id: chainId, message });
    return null;
  }
}

/**
 * The Upoch Score from Upoch's public badge (its label reads "Upoch Score: 61 B"). Null when Upoch has
 * no score for the workflow or cannot be reached: shown as Unknown, never guessed. Mainnet only.
 */
export async function upochScore(chainId: number, workflowId: string | null): Promise<{ score: number; grade: string | null } | null> {
  if (!workflowId || chainId !== MAINNET) return null;
  try {
    const res = await fetch(`${UPOCH_SITE}/api/badge/${workflowId}`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    if (!res.ok) return null;
    const m = /aria-label="Upoch Score: (\d{1,3})(?:\s+([A-F][+-]?))?"/.exec(await res.text());
    return m ? { score: Number(m[1]), grade: m[2] ?? null } : null;
  } catch {
    return null;
  }
}

/** The engines' input: the status fields only. */
/**
 * Wallet addresses trusted to link an Upoch workflow: owners and admins (people, never agent keys) who
 * have been members for at least the organization's loosening delay, or since it was created. A member
 * added just now cannot link a workflow at once, so adding one is no way around the delay.
 */
export async function memberAddresses(orgId: string): Promise<string[]> {
  const rows = await db()`
    SELECT u.address FROM memberships m JOIN users u ON u.id = m.user_id JOIN organizations o ON o.id = m.org_id
    WHERE m.org_id = ${orgId}::uuid AND m.role IN ('owner', 'admin')
      AND (m.created_at <= now() - make_interval(secs => o.loosening_delay_seconds) OR m.created_at <= o.created_at + interval '1 minute')`;
  return rows.map((r) => String(r.address));
}

export const toEngineInput = (d: UpochDetail | null): UpochStatus | null =>
  d === null
    ? null
    : { workflow_id: d.workflow_id, observed_at: d.observed_at, linked: d.linked, active: d.active, checkpoint_count: d.checkpoint_count, last_checkpoint_at: d.last_checkpoint_at, guardians: d.guardians };

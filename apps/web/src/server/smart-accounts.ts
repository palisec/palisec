import "server-only";
import { createPublicClient, getAddress, http, isAddress, recoverAddress, type Address, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ENTRYPOINT_ABI,
  SAFE_4337,
  SAFE_4337_CHAINS,
  SAFE_ABI,
  dummySafeSignature,
  executeCallData,
  maxCostWei,
  normalizeSignature,
  packSafeSignature,
  safeOpHash,
  safeOpTypedDataJson,
  toRpcUserOp,
  type SafeUserOp,
} from "@/lib/safe-op";
import type { AgentContext } from "./access";
import { MAINNET, NETWORKS, TESTNET, isNetworkId, networkLabel } from "@/lib/networks";
import { CHAINS, chainEnabled, defaultChain } from "./config";
import { db, type Row } from "./db";
import { afterChange } from "./events";
import { BadRequest, HttpError, logEvent } from "./http";
import { effectiveState } from "./operations";

/* ───────── Configuration (values never leave the server) ───────── */

/**
 * PALISEC's co-signer for each network, a server-held key in an environment variable. Mainnet has its
 * own key: the testnet key is never used for real funds, even if the same value is put in both variables.
 * The co-signer needs no ETH (each Safe pays its own gas) and cannot move funds alone (threshold 2).
 */
const SIGNER_ENV = { [MAINNET]: "PALISEC_MAINNET_SIGNER_KEY", [TESTNET]: "PALISEC_SIGNER_KEY" } as const;
const readKey = (name: string) => (process.env[name] || "").trim();
const KEY_RE = /^0x[0-9a-fA-F]{64}$/;
const sharesTestnetKey = () => readKey(SIGNER_ENV[MAINNET]).toLowerCase() === readKey(SIGNER_ENV[TESTNET]).toLowerCase();
const signerCache = new Map<number, { key: string; account: PrivateKeyAccount }>();

export function palisecSigner(chainId: number): PrivateKeyAccount | null {
  if (!isNetworkId(chainId)) return null;
  const key = readKey(SIGNER_ENV[chainId]);
  if (!KEY_RE.test(key)) return null;
  if (chainId === MAINNET && sharesTestnetKey()) return null;
  const hit = signerCache.get(chainId);
  if (hit?.key === key) return hit.account;
  const account = privateKeyToAccount(key as Hex);
  signerCache.set(chainId, { key, account });
  return account;
}

/** Why a network's co-signer is unavailable, in words an operator can act on. */
function signerProblem(chainId: number): string {
  if (chainId === MAINNET && KEY_RE.test(readKey(SIGNER_ENV[MAINNET])) && sharesTestnetKey())
    return "The mainnet co-signer key is the same as the testnet key. Give mainnet its own key.";
  return `PALISEC's co-signer for ${networkLabel(chainId)} is not configured on this deployment.`;
}

/** Bundler endpoint. A local test bundler may be named outside Vercel only, never in a deployment. */
export function bundlerUrl(chainId: number): string | null {
  const testUrl = process.env.PALISEC_TEST_BUNDLER_URL;
  if (testUrl && process.env.VERCEL !== "1") return testUrl;
  const key = (process.env.ALCHEMY_API_KEY || "").trim();
  if (!isNetworkId(chainId) || !key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) return null;
  return `https://${NETWORKS[chainId].alchemy}.g.alchemy.com/v2/${key}`;
}

/** Per network: is it on, is its co-signer set, is a bundler configured. Never the values. */
export function smartAccountsStatus(chainId: number) {
  const enabled = chainEnabled(chainId) && SAFE_4337_CHAINS.includes(chainId);
  const signer = palisecSigner(chainId) !== null;
  const bundler = bundlerUrl(chainId) !== null;
  return { enabled, signer, bundler, available: enabled && signer && bundler };
}

function chainClient(chainId: number) {
  if (!chainEnabled(chainId)) return null;
  const chain = CHAINS[chainId];
  return createPublicClient({ transport: http(chain.rpc, { timeout: 8000, retryCount: 1 }) });
}

async function bundlerRpc<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  const url = bundlerUrl(chainId);
  if (!url) throw new HttpError(503, "PS_CHAIN_001", "Smart-account submission is not configured on this deployment.", true);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
  } catch {
    throw new HttpError(503, "PS_CHAIN_001", "The bundler did not respond. Try again shortly.", true);
  }
  const body = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string } } | null;
  if (!body || body.error || !res.ok) {
    // Bundler messages describe the operation (e.g. AA21 not enough funds); they never contain our key.
    const msg = (body?.error?.message || `HTTP ${res.status}`).replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
    logEvent("warn", "bundler.error", { method, message: msg });
    throw new HttpError(502, "PS_CHAIN_001", `Bundler refused ${method}: ${msg}`, true);
  }
  return body.result as T;
}

/* ───────── Account inspection ───────── */

export interface AccountReport {
  chain_id: number;
  address: Address;
  deployed: boolean;
  owners: Address[];
  threshold: number;
  module_enabled: boolean;
  palisec_signer: Address | null;
  palisec_is_owner: boolean;
  enforced: boolean;
  reason: string | null;
}

export async function inspectAccount(chainId: number, raw: string): Promise<AccountReport> {
  if (!isAddress(raw, { strict: false })) throw new BadRequest("address must be a 20-byte hex address");
  const address = getAddress(raw);
  const signer = palisecSigner(chainId)?.address ?? null;
  const base: AccountReport = { chain_id: chainId, address, deployed: false, owners: [], threshold: 0, module_enabled: false, palisec_signer: signer, palisec_is_owner: false, enforced: false, reason: null };
  const c = chainClient(chainId);
  if (!c) return { ...base, reason: `${networkLabel(chainId)} is not enabled on this deployment.` };
  const code = await c.getCode({ address }).catch(() => null);
  if (code === null) throw new HttpError(503, "PS_CHAIN_001", "The chain RPC did not respond.", true);
  if (!code || code === "0x") return { ...base, reason: "No contract at this address. It is a plain key account, which PALISEC cannot enforce." };
  try {
    const [owners, threshold, moduleEnabled] = await Promise.all([
      c.readContract({ address, abi: SAFE_ABI, functionName: "getOwners" }),
      c.readContract({ address, abi: SAFE_ABI, functionName: "getThreshold" }),
      c.readContract({ address, abi: SAFE_ABI, functionName: "isModuleEnabled", args: [SAFE_4337.module] }),
    ]);
    const list = owners.map((o) => getAddress(o));
    const isOwner = signer !== null && list.includes(signer);
    const t = Number(threshold);
    const enforced = moduleEnabled && isOwner && t >= 2;
    const reason = enforced
      ? null
      : !moduleEnabled
        ? "The Safe 4337 module is not enabled on this account."
        : signer === null
          ? signerProblem(chainId)
          : !isOwner
            ? "PALISEC's co-signer is not an owner of this account."
            : "The threshold is 1, so a single key can still move funds.";
    return { ...base, deployed: true, owners: list, threshold: t, module_enabled: moduleEnabled, palisec_is_owner: isOwner, enforced, reason };
  } catch {
    return { ...base, deployed: true, reason: "This contract is not a Safe this deployment recognizes." };
  }
}

/* ───────── Execution: prepare, co-sign and submit, receipt ───────── */

async function loadOperation(orgId: string, id: string, agentId?: string): Promise<Row> {
  const rows = await db()`
    SELECT id, org_id, agent_id, state, expires_at, chain_id, account, target, value_wei, data, gas_limit,
           user_op, user_op_hash, submitted_at, transaction_hash, executed_at, execution_success
    FROM operations
    WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)`;
  if (!rows[0]) throw new HttpError(404, "PS_REQUEST_001", "Operation not found");
  return rows[0];
}

function requireUsable(row: Row) {
  const state = effectiveState(row.state, row.expires_at);
  if (state !== "authorized" && state !== "approved")
    throw new HttpError(409, "PS_AUTH_002", `Only an allowed or approved operation can be executed; this one is ${state}.`);
  if (row.submitted_at) throw new HttpError(409, "PS_REPLAY_001", "This operation was already submitted.");
  const chainId = Number(row.chain_id);
  if (!chainEnabled(chainId) || !SAFE_4337_CHAINS.includes(chainId))
    throw new HttpError(409, "PS_CHAIN_001", `Smart-account execution is not enabled for ${networkLabel(chainId)} on this deployment.`);
  return chainId;
}

const hex = (n: bigint): Hex => `0x${n.toString(16)}`;
const withMargin = (n: bigint, pct: bigint) => (n * (100n + pct)) / 100n;

export interface PreparedExecution {
  operation_id: string;
  chain_id: number;
  safe_op_hash: Hex;
  typed_data: ReturnType<typeof safeOpTypedDataJson>;
  user_operation: SafeUserOp;
  max_cost_wei: string;
  valid_until: string;
}

/**
 * Builds the one user operation PALISEC will co-sign for this decision: the Safe calls exactly the
 * evaluated target with the evaluated value and calldata (operation 0, never a delegate call), valid
 * only until the authorization expires. The agent signs the returned typed data.
 */
export async function prepareExecution(agent: AgentContext, id: string): Promise<PreparedExecution> {
  const row = await loadOperation(agent.orgId, id, agent.agentId);
  const chainId = requireUsable(row);
  if (!palisecSigner(chainId)) throw new HttpError(503, "PS_CHAIN_001", signerProblem(chainId), true);
  const report = await inspectAccount(chainId, row.account);
  if (!report.enforced) throw new HttpError(409, "PS_ACCOUNT_001", `The agent's account is not a PALISEC smart account: ${report.reason}`);

  const c = chainClient(chainId)!;
  const sender = getAddress(row.account);
  const callData = executeCallData(getAddress(row.target), BigInt(row.value_wei), row.data as Hex);
  const [nonce, block, tip] = await Promise.all([
    c.readContract({ address: SAFE_4337.entryPoint, abi: ENTRYPOINT_ABI, functionName: "getNonce", args: [sender, 0n] }),
    c.getBlock({ blockTag: "latest" }),
    bundlerRpc<Hex>(chainId, "rundler_maxPriorityFeePerGas", []).catch(() => c.estimateMaxPriorityFeePerGas().then(hex)),
  ]).catch((e) => {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, "PS_CHAIN_001", "The chain RPC did not respond.", true);
  });
  const priority = withMargin(BigInt(tip), 15n);
  const maxFee = (block.baseFeePerGas ?? 0n) * 2n + priority;
  const validUntil = Math.floor(new Date(row.expires_at).getTime() / 1000);

  const draft: SafeUserOp = {
    sender,
    nonce: hex(nonce),
    callData,
    callGasLimit: hex(BigInt(row.gas_limit)),
    verificationGasLimit: hex(250_000n),
    preVerificationGas: hex(100_000n),
    maxFeePerGas: hex(maxFee),
    maxPriorityFeePerGas: hex(priority),
    validAfter: 0,
    validUntil,
  };
  const est = await bundlerRpc<{ preVerificationGas: Hex; verificationGasLimit: Hex; callGasLimit: Hex }>(chainId, "eth_estimateUserOperationGas", [
    toRpcUserOp(draft, dummySafeSignature(report.threshold)),
    SAFE_4337.entryPoint,
  ]);
  const callGas = withMargin(BigInt(est.callGasLimit), 20n);
  if (BigInt(est.callGasLimit) > BigInt(row.gas_limit))
    throw new HttpError(422, "PS_REQUEST_001", `This call needs about ${BigInt(est.callGasLimit)} gas, more than the gas_limit of ${row.gas_limit} that was authorized. Propose it again with a higher gas_limit.`);
  const op: SafeUserOp = {
    ...draft,
    callGasLimit: hex(callGas < BigInt(row.gas_limit) ? callGas : BigInt(row.gas_limit)),
    verificationGasLimit: hex(withMargin(BigInt(est.verificationGasLimit), 30n)),
    preVerificationGas: hex(withMargin(BigInt(est.preVerificationGas), 20n)),
  };

  const stored = await db()`
    UPDATE operations SET user_op = ${JSON.stringify(op)}::text::jsonb
    WHERE id = ${row.id}::uuid AND submitted_at IS NULL AND state IN ('authorized', 'approved') AND expires_at > now()
    RETURNING id`;
  if (!stored[0]) throw new HttpError(409, "PS_AUTH_002", "The authorization expired or was used while preparing. Propose the operation again.");
  return {
    operation_id: row.id,
    chain_id: chainId,
    safe_op_hash: safeOpHash(op, chainId),
    typed_data: safeOpTypedDataJson(op, chainId),
    user_operation: op,
    max_cost_wei: maxCostWei(op).toString(),
    valid_until: new Date(validUntil * 1000).toISOString(),
  };
}

/**
 * Takes the agent's signature over the prepared operation, checks it comes from an owner other than
 * PALISEC, claims the operation once (with its audit event, in one statement), co-signs, and submits.
 */
export async function submitExecution(agent: AgentContext, id: string, body: Record<string, unknown>) {
  for (const k of Object.keys(body)) if (k !== "signature") throw new BadRequest(`Unknown field: ${k}`);
  if (typeof body.signature !== "string") throw new BadRequest("signature must be the agent's 65-byte signature over typed_data");
  let agentSig: Hex;
  try {
    agentSig = normalizeSignature(body.signature as Hex);
  } catch (e) {
    throw new BadRequest((e as Error).message);
  }
  const row = await loadOperation(agent.orgId, id, agent.agentId);
  const chainId = requireUsable(row);
  if (!row.user_op) throw new HttpError(409, "PS_REQUEST_001", "Prepare the operation first: POST /v1/operations/{id}/user-operation.");
  const op = row.user_op as SafeUserOp;
  if (getAddress(op.sender) !== getAddress(row.account)) throw new HttpError(409, "PS_STATE_001", "Prepared operation does not match the agent's account.");
  if (op.validUntil <= Math.floor(Date.now() / 1000) + 5) throw new HttpError(409, "PS_AUTH_002", "The authorization is about to expire. Propose the operation again.");

  const signer = palisecSigner(chainId);
  if (!signer) throw new HttpError(503, "PS_CHAIN_001", signerProblem(chainId), true);
  const hash = safeOpHash(op, chainId);
  const agentSigner = await recoverAddress({ hash, signature: agentSig }).catch(() => null);
  const report = await inspectAccount(chainId, op.sender);
  if (!report.enforced) throw new HttpError(409, "PS_ACCOUNT_001", `The agent's account is not a PALISEC smart account: ${report.reason}`);
  if (!agentSigner || agentSigner === signer.address || !report.owners.includes(agentSigner))
    throw new HttpError(403, "PS_AUTH_003", "The signature is not from an owner of this smart account. Sign typed_data with the agent's key.");
  if (report.threshold !== 2) throw new HttpError(409, "PS_ACCOUNT_001", "PALISEC co-signs accounts with a threshold of exactly 2.");

  const claimed = await db()`
    WITH c AS (
      UPDATE operations SET submitted_at = now()
      WHERE id = ${row.id}::uuid AND agent_id = ${agent.agentId}::uuid AND submitted_at IS NULL
        AND state IN ('authorized', 'approved') AND expires_at > now()
      RETURNING id, org_id, agent_id
    )
    INSERT INTO audit_events (org_id, type, detail)
    SELECT org_id, 'operation.cosigned', jsonb_build_object('operation_id', id, 'agent_id', agent_id, 'account', ${op.sender}::text,
           'agent_signer', ${agentSigner}::text, 'palisec_signer', ${signer.address}::text, 'safe_op_hash', ${hash}::text, 'chain_id', ${chainId}::int)
    FROM c RETURNING event_id`;
  if (!claimed[0]) throw new HttpError(409, "PS_REPLAY_001", "This operation was already submitted or its authorization expired.");

  const palisecSig = await signer.sign({ hash });
  const signature = packSafeSignature(op.validAfter, op.validUntil, [
    { signer: agentSigner, signature: agentSig },
    { signer: signer.address, signature: palisecSig },
  ]);
  let userOpHash: Hex;
  try {
    userOpHash = await bundlerRpc<Hex>(chainId, "eth_sendUserOperation", [toRpcUserOp(op, signature), SAFE_4337.entryPoint]);
  } catch (e) {
    // Nothing reached the chain: release the claim so the same prepared operation can be retried.
    await db()`
      WITH r AS (UPDATE operations SET submitted_at = NULL WHERE id = ${row.id}::uuid AND user_op_hash IS NULL RETURNING id, org_id)
      INSERT INTO audit_events (org_id, type, detail)
      SELECT org_id, 'operation.submit_failed', jsonb_build_object('operation_id', id, 'message', ${(e as Error).message.slice(0, 300)}::text) FROM r`;
    throw e;
  }
  await db()`UPDATE operations SET user_op_hash = ${userOpHash.toLowerCase()} WHERE id = ${row.id}::uuid`;
  afterChange(agent.orgId, "operation.submitted", { operation_id: row.id, agent_id: agent.agentId, chain_id: chainId, account: op.sender, user_op_hash: userOpHash });
  return { operation_id: row.id, chain_id: chainId, status: "submitted", user_op_hash: userOpHash, safe_op_hash: hash };
}

export interface ExecutionStatus {
  operation_id: string;
  chain_id: number;
  status: "not_prepared" | "prepared" | "submitted" | "executed" | "reverted";
  user_op_hash: string | null;
  transaction_hash: string | null;
  submitted_at: string | null;
  executed_at: string | null;
}

const statusOf = (row: Row): ExecutionStatus => ({
  operation_id: row.id,
  chain_id: Number(row.chain_id),
  status: row.executed_at ? (row.execution_success ? "executed" : "reverted") : row.submitted_at ? "submitted" : row.user_op ? "prepared" : "not_prepared",
  user_op_hash: row.user_op_hash ?? null,
  transaction_hash: row.transaction_hash ?? null,
  submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
  executed_at: row.executed_at ? new Date(row.executed_at).toISOString() : null,
});

/** Reads the bundler's receipt once the operation is in flight, and records the outcome exactly once. */
export async function executionStatus(orgId: string, id: string, agentId?: string): Promise<ExecutionStatus> {
  const row = await loadOperation(orgId, id, agentId);
  if (!row.user_op_hash || row.executed_at) return statusOf(row);
  const receipt = await bundlerRpc<{ success: boolean; receipt: { transactionHash: Hex } } | null>(Number(row.chain_id), "eth_getUserOperationReceipt", [row.user_op_hash]).catch(() => null);
  if (!receipt?.receipt?.transactionHash) return statusOf(row);
  const tx = receipt.receipt.transactionHash.toLowerCase();
  const updated = await db()`
    WITH u AS (
      UPDATE operations SET transaction_hash = ${tx}, executed_at = now(), execution_success = ${receipt.success}
      WHERE id = ${row.id}::uuid AND executed_at IS NULL RETURNING id, org_id, agent_id
    )
    INSERT INTO audit_events (org_id, type, detail)
    SELECT org_id, 'operation.executed', jsonb_build_object('operation_id', id, 'agent_id', agent_id, 'transaction_hash', ${tx}::text, 'success', ${receipt.success}::boolean)
    FROM u RETURNING event_id`;
  if (updated[0]) afterChange(orgId, "operation.executed", { operation_id: row.id, agent_id: row.agent_id, transaction_hash: tx, success: receipt.success });
  return statusOf({ ...row, transaction_hash: tx, executed_at: new Date(), execution_success: receipt.success });
}

/** The network a request names with ?chain_id=, or the deployment's default. Disabled networks are refused. */
export function requestedChain(req: Request): number {
  const raw = new URL(req.url).searchParams.get("chain_id");
  if (raw === null || raw === "") return defaultChain();
  const id = Number(raw);
  if (!Number.isInteger(id) || !chainEnabled(id))
    throw new HttpError(400, "PS_CHAIN_001", `chain_id must be an enabled network: ${[MAINNET, TESTNET].filter((n) => chainEnabled(n)).join(", ")}`);
  return id;
}

/** Public configuration agents and the console need, for one network. Addresses only. */
export function smartAccountConfig(chainId: number) {
  const s = smartAccountsStatus(chainId);
  return {
    chain_id: chainId,
    network: networkLabel(chainId),
    palisec_signer: palisecSigner(chainId)?.address ?? null,
    threshold: 2,
    entry_point: SAFE_4337.entryPoint,
    safe_4337_module: SAFE_4337.module,
    safe_module_setup: SAFE_4337.moduleSetup,
    safe_singleton: SAFE_4337.singleton,
    safe_proxy_factory: SAFE_4337.proxyFactory,
    submission: s.available ? "available" : "not_configured",
  };
}

/** Each registered agent's account on one network, inspected, for the console. */
export async function agentAccounts(orgId: string, chainId: number) {
  const agents = await db()`SELECT id, name, status, chain_id, account FROM agents WHERE org_id = ${orgId}::uuid AND chain_id = ${chainId}::int ORDER BY created_at DESC LIMIT 25`;
  return Promise.all(
    agents.map(async (a) => ({
      agent_id: a.id,
      agent_name: a.name,
      agent_status: a.status,
      account: await inspectAccount(Number(a.chain_id), a.account).catch(() => null),
    })),
  );
}

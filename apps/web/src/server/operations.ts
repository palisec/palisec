import "server-only";
import { evaluateDual, type Disagreement } from "@palisec/policy-engine";
import {
  type evaluate,
  fingerprint,
  RETRYABLE,
  selectorOf,
  type CheckResult,
  type Decision,
  type AssetIntent,
  type Environment,
  type Intent,
  type LedgerState,
  type Policy,
  type ReasonCode,
  type Reservation,
} from "@palisec/policy-schema";
import { getAddress, isAddress } from "viem";
import type { AgentContext } from "./access";
import { meterDecision, unmeterDecision, type Meter } from "./billing";
import { declaredIntent, parseAssetIntent, simulateOperation } from "./asset-sim";
import { memberAddresses, readUpoch, toEngineInput } from "./upoch";
import { ethUsd, gasPriceWei, hasDeployedCode } from "./chain-env";
import { CHAINS, type ChainId } from "./config";
import { db, type Row } from "./db";
import { BadRequest, HttpError, logEvent } from "./http";
import { canonicalJson, randomHex, sha256Hex } from "./tokens";
import { signReceipt } from "./peaa";
import type { ReceiptJson } from "policy-enforced-accounts";

/** How long an ALLOW can be used, and how long a request may wait for a human approver. */
export const AUTHORIZATION_TTL_SECONDS = 300;
export const APPROVAL_TTL_SECONDS = 15 * 60;
const MAX_CALLDATA_BYTES = 65536;
export const MAX_OPERATION_BODY = 2 * MAX_CALLDATA_BYTES + 4096;
const MAX_DEADLINE_SECONDS = 3600;

export interface IntentInput {
  request_id: string;
  chain_id: number;
  to: `0x${string}`;
  value_wei: string;
  data: `0x${string}`;
  gas_limit: number;
  deadline: number;
  /** Phase 6, optional: what the operation spends (at most) and receives (quoted), per token. */
  asset_intent?: AssetIntent;
}

/** Validates an agent's request body. The sender is never taken from the body: it is the agent's account. */
export function parseIntent(body: Record<string, unknown>): IntentInput {
  const allowed = ["request_id", "chain_id", "to", "value_wei", "data", "gas_limit", "deadline", "asset_intent"];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new BadRequest(`Unknown field: ${k}`);
  const { request_id, chain_id, to, value_wei, data, gas_limit, deadline } = body;
  const assetIntent = parseAssetIntent(body.asset_intent);
  if (typeof request_id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(request_id))
    throw new BadRequest("request_id must be 1-128 characters of A-Z a-z 0-9 _ . : -");
  if (typeof chain_id !== "number" || !Number.isInteger(chain_id)) throw new BadRequest("chain_id must be an integer");
  if (typeof to !== "string" || !isAddress(to, { strict: false })) throw new BadRequest("to must be a 20-byte hex address");
  if (typeof value_wei !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value_wei)) throw new BadRequest("value_wei must be a non-negative integer string");
  const d = data ?? "0x";
  if (typeof d !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(d)) throw new BadRequest("data must be 0x-prefixed hex bytes");
  if ((d.length - 2) / 2 > MAX_CALLDATA_BYTES) throw new BadRequest(`data exceeds ${MAX_CALLDATA_BYTES} bytes`);
  if (typeof gas_limit !== "number" || !Number.isInteger(gas_limit) || gas_limit < 21000 || gas_limit > 30_000_000)
    throw new BadRequest("gas_limit must be an integer between 21000 and 30000000");
  if (typeof deadline !== "number" || !Number.isInteger(deadline)) throw new BadRequest("deadline must be unix seconds");
  if (deadline > Math.floor(Date.now() / 1000) + MAX_DEADLINE_SECONDS) throw new BadRequest(`deadline must be within ${MAX_DEADLINE_SECONDS} seconds`);
  return {
    request_id, chain_id, to: getAddress(to), value_wei, data: d.toLowerCase() as `0x${string}`, gas_limit, deadline,
    ...(assetIntent ? { asset_intent: assetIntent } : {}),
  };
}

interface Prepared {
  intent: Intent;
  input: IntentInput;
  policy: Policy | null;
  policyUuid: string | null;
  requestHash: string;
  calldataFp: string;
  intentFp: string;
  usdMicros: bigint;
  feeWei: bigint | null;
  result: ReturnType<typeof evaluate>;
}

/** Engine disagreements are rare and always worth a look: one structured line, no request body. */
const reportEngine = (d: Disagreement) => logEvent("error", "policy_engine.fail_closed", d);

const LIVE_DETAIL =
  "Performed at execution, not at decision: when the agent executes through a PALISEC smart account (POST /v1/operations/{id}/user-operation, then /submit), PALISEC co-signs this exact payload and the Safe validates both signatures on chain. An agent that sends from a plain key is not enforced on chain.";

/**
 * Fee bound, price and code check for one request, and (Phase 6) the asset simulation when the policy
 * asks for it. Each lookup may be null, and the evaluator fails closed.
 */
async function liveEnvironment(
  input: Pick<IntentInput, "chain_id" | "to" | "gas_limit" | "value_wei" | "data">,
  now: number,
  emergencyStop: boolean,
  pausedAgents: string[],
  simulateFrom: `0x${string}` | null = null,
  upoch: { orgId: string; account: string; workflowId: string | null } | null = null,
) {
  const chainEnabled = CHAINS[input.chain_id as ChainId]?.enabled === true;
  const simulate = simulateFrom !== null && chainEnabled && input.data !== "0x";
  const [gasPrice, price, code, sim, up] = await Promise.all([
    chainEnabled ? gasPriceWei(input.chain_id) : null,
    ethUsd(),
    chainEnabled ? hasDeployedCode(input.chain_id, input.to) : null,
    simulate
      ? simulateOperation({ chainId: input.chain_id, account: simulateFrom, to: input.to, valueWei: BigInt(input.value_wei), data: input.data, gasLimit: input.gas_limit })
      : null,
    upoch && chainEnabled ? memberAddresses(upoch.orgId).then((m) => readUpoch(input.chain_id, upoch.account, upoch.workflowId, m)) : null,
  ]);
  if (sim) logEvent("info", "asset_sim.done", { chain_id: input.chain_id, ms: sim.ms, available: sim.sim !== null });
  const feeWei = gasPrice === null ? null : gasPrice * BigInt(input.gas_limit);
  const env: Environment = {
    now,
    fee_estimate_wei: feeWei === null ? null : feeWei.toString(),
    eth_usd: price,
    verified_code: code ? { [input.to.toLowerCase()]: true } : {},
    emergency_stop: emergencyStop,
    paused_agents: pausedAgents,
    ...(simulate ? { asset_simulation: sim?.sim ?? null } : {}),
    // Phase 6.5: only read (and passed) when the policy requires Upoch recovery.
    ...(upoch ? { upoch: toEngineInput(up ?? null) } : {}),
  };
  return { env, feeWei, simulationMs: sim?.ms ?? null };
}

/** Asset safety applies to this policy: the request's declared intent goes to the engines and the operation is simulated. */
const assetSafetyOn = (p: Policy | null) => p?.asset_safety?.enabled === true;

/** Disabled chains deny, and live-only checks say plainly that this deployment does not perform them. */
function finish(r: ReturnType<typeof evaluate>, chainId: number) {
  let result = r;
  if (CHAINS[chainId as ChainId]?.enabled !== true && result.decision !== "DENY") {
    result = {
      ...result,
      decision: "DENY",
      reason_code: "PS_CHAIN_001",
      retryable: RETRYABLE.PS_CHAIN_001,
      authorization_id: null,
      message: `Chain ${chainId} is not enabled on this deployment.`,
    };
  }
  const checks: CheckResult[] = result.checks.map((c) => (c.enforcement === "live" ? { ...c, detail: LIVE_DETAIL } : c));
  return { result, checks };
}

/**
 * Runs a policy draft against one test transaction with live fee and price inputs and an empty
 * ledger (no budget used, no cooldowns). Nothing is recorded. Used by the policy editor's test panel.
 */
export async function testDraft(doc: Record<string, unknown>, body: Record<string, unknown>) {
  const account = doc.account as { chain_id?: number; address?: string } | undefined;
  if (!account?.address || typeof account.chain_id !== "number") throw new BadRequest("The draft needs an account before it can be tested");
  const now = Math.floor(Date.now() / 1000);
  const input = parseIntent({ request_id: "draft_test", chain_id: account.chain_id, deadline: now + 60, gas_limit: 100000, data: "0x", value_wei: "0", ...body });
  const policy = { ...doc, version: 1, status: "active" } as unknown as Policy;
  const { asset_intent: declared, gas_limit: _g, ...base } = input;
  void _g;
  const intent: Intent = { ...base, agent_id: "draft_test", from: getAddress(account.address) };
  if (assetSafetyOn(policy)) intent.asset_intent = declaredIntent(declared ?? null, input.to, input.value_wei, input.data);
  const { env } = await liveEnvironment(input, now, false, [], assetSafetyOn(policy) ? intent.from : null);
  const { result, checks } = finish(evaluateDual(policy, intent, { reservations: [], seen_request_ids: [], calldata_seen: {}, intent_seen: {} }, env, reportEngine), input.chain_id);
  return { decision: result.decision, reason_code: result.reason_code, message: result.message, checks, inputs: { fee_estimate_wei: env.fee_estimate_wei, eth_usd: env.eth_usd } };
}

/** Snapshot of authoritative state, then both evaluators (Rust and reference, which must agree). Pure read: nothing is recorded. */
async function prepare(agent: AgentContext, input: IntentInput): Promise<Prepared> {
  const selector = selectorOf(input.data);
  const intent: Intent = {
    request_id: input.request_id,
    agent_id: agent.agentId,
    chain_id: input.chain_id,
    from: agent.account,
    to: input.to,
    value_wei: input.value_wei,
    data: input.data,
    deadline: input.deadline,
  };
  // The same fingerprints the reference evaluator uses, so the database recheck agrees with it.
  const calldataFp = fingerprint(`${intent.to.toLowerCase()}|${intent.data.toLowerCase()}`);
  const intentFp = fingerprint(`${intent.agent_id}|${intent.to.toLowerCase()}|${selector ?? "native"}|${intent.value_wei}`);
  const requestHash = await sha256Hex(canonicalJson({ ...input, from: agent.account }));

  const [snap] = await db()`
    SELECT
      (SELECT pv.document FROM policies p JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
        WHERE p.id = ${agent.policyId}::uuid AND p.disabled_at IS NULL) AS policy,
      (SELECT coalesce(json_agg(json_build_object(
          'id', id, 'request_id', request_id, 'state', state, 'usd', usd_micros::text, 'version', policy_version,
          'created', extract(epoch FROM created_at)::bigint, 'expires', extract(epoch FROM expires_at)::bigint)), '[]'::json)
        FROM operations WHERE policy_id = ${agent.policyId}::uuid AND created_at > now() - interval '1 hour'
          AND ps_holds_budget(state, expires_at)) AS holds,
      EXISTS (SELECT 1 FROM operations WHERE agent_id = ${agent.agentId}::uuid AND request_id = ${input.request_id}) AS seen,
      (SELECT extract(epoch FROM max(created_at))::bigint FROM operations
        WHERE agent_id = ${agent.agentId}::uuid AND calldata_fp = ${calldataFp} AND state <> 'denied') AS calldata_at,
      (SELECT extract(epoch FROM max(created_at))::bigint FROM operations
        WHERE agent_id = ${agent.agentId}::uuid AND intent_fp = ${intentFp} AND state <> 'denied') AS intent_at,
      extract(epoch FROM now())::bigint AS now`;

  const now = Number(snap.now);
  const policy = (snap.policy as Policy | null) ?? null;
  const reservations: Reservation[] = (snap.holds as Row[]).map((h) => ({
    reservation_id: h.id,
    request_id: h.request_id,
    agent_id: agent.agentId,
    policy_version: h.version,
    amount_usd_micros: h.usd,
    created_at: Number(h.created),
    expires_at: Number(h.expires),
    // Expired authorizations still hold budget (they may have been executed), but no longer a slot.
    state: h.state === "pending_approval" ? "pending_approval" : Number(h.expires) > now ? "reserved" : "finalized",
  }));
  const state: LedgerState = {
    reservations,
    seen_request_ids: snap.seen ? [input.request_id] : [],
    calldata_seen: snap.calldata_at != null ? { [calldataFp]: Number(snap.calldata_at) } : {},
    intent_seen: snap.intent_at != null ? { [intentFp]: Number(snap.intent_at) } : {},
  };

  if (assetSafetyOn(policy)) intent.asset_intent = declaredIntent(input.asset_intent ?? null, input.to, input.value_wei, input.data);
  const { env, feeWei } = await liveEnvironment(
    input, now, agent.emergencyStop, agent.agentStatus === "active" ? [] : [agent.agentId], assetSafetyOn(policy) ? agent.account : null,
    policy?.upoch_recovery?.require_upoch_recoverable === true ? { orgId: agent.orgId, account: agent.account, workflowId: agent.upochWorkflowId } : null,
  );
  const { result, checks } = finish(evaluateDual(policy, intent, state, env, reportEngine), input.chain_id);
  const reserved = result.next_state.reservations.find((r) => r.request_id === input.request_id && r.state !== "released");
  return {
    intent,
    input,
    policy,
    policyUuid: agent.policyId,
    requestHash,
    calldataFp,
    intentFp,
    usdMicros: reserved ? BigInt(reserved.amount_usd_micros) : 0n,
    feeWei,
    result: { ...result, checks },
  };
}

export interface DecisionResponse {
  request_id: string;
  operation_id: string | null;
  decision: Decision;
  reason_code: ReasonCode | null;
  policy_id: string | null;
  policy_version: number | null;
  state: string;
  authorization_id: string | null;
  expires_at: string | null;
  transaction_hash: string | null;
  retryable: boolean;
  message: string;
  checks: CheckResult[];
  dry_run: boolean;
  /** Phase 8: EIP-712 decision receipt (draft ERC Policy-Enforced Agent Accounts), for opted-in accounts. */
  receipt?: ReceiptJson | null;
}

/** POST /v1/authorizations/evaluate: what would happen now. Consumes nothing and reserves nothing. */
export async function dryRun(agent: AgentContext, input: IntentInput): Promise<DecisionResponse> {
  const p = await prepare(agent, input);
  const r = p.result;
  const receipt = await signReceipt({
    chainId: input.chain_id, account: agent.account, target: input.to, valueWei: input.value_wei, data: input.data,
    decision: r.decision, reasonCode: r.reason_code, policy: p.policy, policyVersion: r.policy_version,
    issuedAt: new Date(), expiresAt: null, decisionId: `dry_run:${agent.agentId}:${input.request_id}`,
  });
  return {
    receipt,
    request_id: input.request_id,
    operation_id: null,
    decision: r.decision,
    reason_code: r.reason_code,
    policy_id: r.policy_id,
    policy_version: r.policy_version,
    state: "not_recorded",
    authorization_id: null,
    expires_at: null,
    transaction_hash: null,
    retryable: r.retryable,
    // The evaluator's ALLOW message describes a real decision ("Budget reserved…"); a dry run reserves nothing.
    message:
      r.decision === "DENY"
        ? r.message
        : r.decision === "ALLOW"
          ? "Would be authorized: every check passed. Dry run: nothing was reserved, signed or sent."
          : `${r.message} Dry run: nothing was reserved.`,
    checks: r.checks,
    dry_run: true,
  };
}

/** POST /v1/operations: evaluates, then records atomically (reservation, replay, loop state, audit). */
export async function createOperation(
  agent: AgentContext,
  input: IntentInput,
  idempotencyKey: string | null,
): Promise<{ status: number; body: DecisionResponse; replayed: boolean; meter: Meter | null }> {
  const p = await prepare(agent, input);
  // Phase 5: one mainnet decision is metered before it is recorded (402 PS_CREDIT_001 when nothing is
  // left); the unit is given back below if no decision is recorded. The evaluation itself is unchanged.
  const meter = await meterDecision(agent, input.request_id);
  try {
    const res = await recordOperation(agent, input, idempotencyKey, p);
    if (res.replayed) await unmeterDecision(agent, meter, input.request_id);
    if (res.body.operation_id)
      res.body.receipt = await signReceipt({
        chainId: input.chain_id, account: agent.account, target: input.to, valueWei: input.value_wei, data: input.data,
        decision: res.body.decision, reasonCode: res.body.reason_code, policy: p.policy, policyVersion: res.body.policy_version,
        issuedAt: new Date((res.body as { created_at?: string }).created_at ?? Date.now()), expiresAt: res.body.expires_at ? new Date(res.body.expires_at) : null,
        decisionId: res.body.operation_id,
      });
    return { ...res, meter: res.replayed ? null : meter };
  } catch (e) {
    await unmeterDecision(agent, meter, input.request_id).catch(() => {});
    throw e;
  }
}

async function recordOperation(
  agent: AgentContext,
  input: IntentInput,
  idempotencyKey: string | null,
  p: Prepared,
): Promise<{ status: number; body: DecisionResponse; replayed: boolean }> {
  const r = p.result;
  const limits = p.policy?.limits;
  const cooldowns = p.policy?.cooldowns;
  const op = {
    org_id: agent.orgId,
    agent_id: agent.agentId,
    credential_id: agent.credentialId,
    policy_id: p.policy ? p.policyUuid : null,
    policy_version: r.policy_version,
    request_id: input.request_id,
    idempotency_key: idempotencyKey,
    request_hash: p.requestHash,
    chain_id: input.chain_id,
    account: agent.account,
    target: input.to,
    value_wei: input.value_wei,
    data: input.data,
    selector: selectorOf(input.data),
    gas_limit: input.gas_limit,
    fee_wei: p.feeWei?.toString() ?? null,
    usd_micros: p.usdMicros.toString(),
    deadline: input.deadline,
    calldata_fp: p.calldataFp,
    intent_fp: p.intentFp,
    decision: r.decision,
    reason_code: r.reason_code,
    message: r.message,
    checks: r.checks,
    authorization_id: `ps_auth_${randomHex(16)}`,
    authorization_ttl: AUTHORIZATION_TTL_SECONDS,
    approval_ttl: APPROVAL_TTL_SECONDS,
  };
  const lim = {
    hourly_budget_usd_micros: limits?.hourly_budget_usd_micros ?? "0",
    max_pending_operations: limits?.max_pending_operations ?? 0,
    identical_calldata_seconds: cooldowns?.identical_calldata_seconds ?? 0,
    identical_intent_seconds: cooldowns?.identical_intent_seconds ?? 0,
  };
  const [{ result }] = await db()`SELECT ps_record_operation(${JSON.stringify(op)}::text::jsonb, ${JSON.stringify(lim)}::text::jsonb) AS result`;
  const outcome = result.outcome as string;
  if (outcome === "replay") throw new HttpError(409, "PS_REPLAY_001", `request_id ${input.request_id} was already used by this agent`);
  if (outcome === "idempotency_conflict")
    throw new HttpError(409, "PS_REPLAY_001", "Idempotency-Key was already used with a different request");
  const stored = await getOperation(agent.orgId, result.id, agent.agentId);
  if (!stored) throw new HttpError(503, "PS_STATE_001", "Authoritative state unavailable", true);
  return { status: outcome === "idempotent" ? 200 : 201, body: stored, replayed: outcome === "idempotent" };
}

/** Derived state: expiry is read, not written (decision 0002). */
export function effectiveState(state: string, expiresAt: Date | string | null): string {
  const expired = expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
  if (state === "pending_approval" && expired) return "expired";
  if ((state === "authorized" || state === "approved") && expired) return "authorization_expired";
  return state;
}

export function toDecision(row: Row): DecisionResponse & { agent_id: string; created_at: string; details: Record<string, unknown> } {
  const state = effectiveState(row.state, row.expires_at);
  const usable = state === "authorized" || state === "approved";
  return {
    request_id: row.request_id,
    operation_id: row.id,
    agent_id: row.agent_id,
    decision: row.decision,
    reason_code: row.reason_code,
    policy_id: row.policy_key ?? null,
    policy_version: row.policy_version,
    state,
    authorization_id: usable ? row.authorization_id : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    transaction_hash: row.transaction_hash ?? null,
    retryable: row.reason_code ? (RETRYABLE[row.reason_code as ReasonCode] ?? false) : false,
    message: row.message,
    checks: row.checks,
    dry_run: false,
    created_at: new Date(row.created_at).toISOString(),
    details: {
      chain_id: row.chain_id,
      account: row.account,
      target: row.target,
      value_wei: String(row.value_wei),
      selector: row.selector,
      data: row.data,
      gas_limit: row.gas_limit == null ? null : Number(row.gas_limit),
      fee_estimate_wei: row.fee_wei == null ? null : String(row.fee_wei),
      exposure_usd_micros: String(row.usd_micros),
      request_hash: row.request_hash,
      agent_name: row.agent_name,
      decided_by: row.decided_by_address ?? null,
      decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
      execution: row.user_op_hash || row.submitted_at
        ? {
            user_op_hash: row.user_op_hash ?? null,
            submitted_at: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
            executed_at: row.executed_at ? new Date(row.executed_at).toISOString() : null,
            success: row.execution_success ?? null,
          }
        : null,
    },
  };
}

export async function getOperation(orgId: string, id: string, agentId?: string) {
  const rows = await db()`
    SELECT o.*, p.policy_key, a.name AS agent_name, u.address AS decided_by_address
    FROM operations o JOIN agents a ON a.id = o.agent_id
    LEFT JOIN policies p ON p.id = o.policy_id LEFT JOIN users u ON u.id = o.decided_by
    WHERE o.id = ${id}::uuid AND o.org_id = ${orgId}::uuid AND (${agentId ?? null}::uuid IS NULL OR o.agent_id = ${agentId ?? null}::uuid)`;
  return rows[0] ? toDecision(rows[0]) : null;
}

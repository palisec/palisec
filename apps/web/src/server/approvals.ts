import "server-only";
import { createPublicClient, http, isHex, keccak256, verifyTypedData, type Hex } from "viem";
import type { AgentContext, MemberContext } from "./access";
import { CHAINS, VERIFY_CHAIN } from "./config";
import { db } from "./db";
import { BadRequest, HttpError } from "./http";
import { AUTHORIZATION_TTL_SECONDS, getOperation, toDecision } from "./operations";
import { randomHex } from "./tokens";

/*
 * Human approvals (spec §6.3, §11.5). The approver signs EIP-712 typed data that names the exact
 * operation: request hash, account, chain, target, value, calldata hash, policy version and expiry.
 * The signature is checked against the approver's own signed-in wallet and stored with the record.
 * Approval is refused if the operation expired, the agent was paused, the organization stopped, or
 * the policy version changed since evaluation.
 */

export const APPROVAL_DOMAIN = { name: "Palisec", version: "1" } as const;
export const APPROVAL_TYPES = {
  OperationApproval: [
    { name: "operationId", type: "string" },
    { name: "requestHash", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "account", type: "address" },
    { name: "target", type: "address" },
    { name: "valueWei", type: "uint256" },
    { name: "dataHash", type: "bytes32" },
    { name: "policyVersion", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

async function loadPending(ctx: MemberContext, id: string) {
  const [op] = await db()`
    SELECT o.* FROM operations o WHERE o.id = ${id}::uuid AND o.org_id = ${ctx.orgId}::uuid`;
  if (!op) throw new HttpError(404, "RW_REQUEST_001", "Operation not found in this organization");
  return op;
}

export function typedDataFor(op: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    domain: APPROVAL_DOMAIN,
    types: APPROVAL_TYPES,
    primaryType: "OperationApproval" as const,
    message: {
      operationId: op.id as string,
      requestHash: `0x${op.request_hash}` as Hex,
      chainId: BigInt(op.chain_id),
      account: op.account as Hex,
      target: op.target as Hex,
      valueWei: BigInt(String(op.value_wei)),
      dataHash: keccak256(op.data as Hex),
      policyVersion: BigInt(op.policy_version ?? 0),
      expiresAt: BigInt(Math.floor(new Date(op.expires_at).getTime() / 1000)),
    },
  };
}

/** JSON-safe form of the typed data for wallets (bigints as decimal strings). */
export function typedDataJson(op: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = typedDataFor(op);
  return {
    ...t,
    types: { EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }], ...t.types },
    message: Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])),
  };
}

export async function listApprovals(ctx: MemberContext, params: URLSearchParams) {
  const status = params.get("status") ?? "pending";
  if (!["pending", "decided"].includes(status)) throw new BadRequest("status must be pending or decided");
  const rows = await db()`
    SELECT o.*, p.policy_key, a.name AS agent_name, u.address AS decided_by_address
    FROM operations o JOIN agents a ON a.id = o.agent_id
    LEFT JOIN policies p ON p.id = o.policy_id LEFT JOIN users u ON u.id = o.decided_by
    WHERE o.org_id = ${ctx.orgId}::uuid AND o.decision = 'REQUIRES_HUMAN_SIGNATURE'
      AND (CASE WHEN ${status} = 'pending' THEN o.state = 'pending_approval' AND o.expires_at > now()
                ELSE NOT (o.state = 'pending_approval' AND o.expires_at > now()) END)
    ORDER BY o.created_at DESC LIMIT 100`;
  return rows.map((r) => ({ ...toDecision(r), typed_data: r.state === "pending_approval" ? typedDataJson(r) : null }));
}

async function signatureFrom(address: Hex, typed: ReturnType<typeof typedDataFor>, signature: Hex) {
  if (await verifyTypedData({ address, signature, ...typed }).catch(() => false)) return true;
  // Smart-contract wallets (ERC-1271) verify against the chain.
  const client = createPublicClient({ transport: http(CHAINS[VERIFY_CHAIN].rpc, { timeout: 8000, retryCount: 1 }) });
  return client.verifyTypedData({ address, signature, ...typed }).catch(() => false);
}

export async function approve(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const signature = body.signature;
  if (typeof signature !== "string" || !isHex(signature) || signature.length > 4096) throw new BadRequest("signature must be hex");
  const op = await loadPending(ctx, id);
  if (op.state !== "pending_approval") throw new HttpError(409, "RW_REPLAY_001", `Operation is ${op.state}, not pending approval`);
  if (new Date(op.expires_at).getTime() <= Date.now()) throw new HttpError(409, "RW_REPLAY_001", "The approval window has expired");
  const typed = typedDataFor(op);
  if (!(await signatureFrom(ctx.user.address as Hex, typed, signature)))
    throw new HttpError(401, "RW_AUTH_001", "Signature does not match this operation and your signed-in wallet");

  // One statement: every precondition is re-read at the moment of approval.
  const rows = await db()`
    WITH o AS (
      UPDATE operations o SET state = 'approved', decided_by = ${ctx.user.userId}::uuid, decided_at = now(),
        approval_signature = ${signature}, authorization_id = ${`rw_auth_${randomHex(16)}`},
        expires_at = now() + make_interval(secs => ${AUTHORIZATION_TTL_SECONDS}::int)
      FROM agents a, organizations g, policies p
      WHERE o.id = ${id}::uuid AND o.org_id = ${ctx.orgId}::uuid AND o.state = 'pending_approval' AND o.expires_at > now()
        AND o.request_hash = ${op.request_hash}
        AND a.id = o.agent_id AND a.status = 'active'
        AND g.id = o.org_id AND NOT g.emergency_stop
        AND p.id = o.policy_id AND p.disabled_at IS NULL AND p.active_version = o.policy_version
      RETURNING o.id, o.org_id, o.agent_id, o.request_id, o.policy_version
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, agent_id, 'operation.approved',
        jsonb_build_object('operation_id', id, 'request_id', request_id, 'policy_version', policy_version, 'signature_scheme', 'eip712')
      FROM o
    )
    SELECT id FROM o`;
  if (rows.length === 0)
    throw new HttpError(409, "RW_PAUSED_001", "Approval refused: the agent is paused, the organization is stopped, or the policy changed since evaluation");
  return getOperation(ctx.orgId, id);
}

export async function reject(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 280) : null;
  const rows = await db()`
    WITH o AS (
      UPDATE operations SET state = 'rejected', decided_by = ${ctx.user.userId}::uuid, decided_at = now()
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid AND state = 'pending_approval' AND expires_at > now()
      RETURNING id, org_id, agent_id, request_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, agent_id, 'operation.rejected',
        jsonb_build_object('operation_id', id, 'request_id', request_id, 'reason', ${reason}::text)
      FROM o
    )
    SELECT id FROM o`;
  if (rows.length === 0) throw new HttpError(409, "RW_REPLAY_001", "Operation is not pending approval (it may have expired)");
  return getOperation(ctx.orgId, id);
}

/**
 * Cancels an operation and releases its reservation.
 *
 * An agent may only withdraw a request still waiting for approval. It may not release an ALLOW: until
 * receipt reconciliation exists nobody can prove the transaction was not sent, so an agent could
 * execute, cancel, and spend past its budget. A console operator may release an unexpired
 * authorization they know was not used; that is recorded with their identity. After expiry nobody can
 * cancel, and the amount stays counted.
 */
export async function cancel(orgId: string, id: string, actor: { agent?: AgentContext; userId?: string }) {
  const agentId = actor.agent?.agentId ?? null;
  const states = agentId ? ["pending_approval"] : ["authorized", "approved", "pending_approval"];
  const rows = await db()`
    WITH o AS (
      UPDATE operations SET state = 'cancelled', decided_at = now(), decided_by = ${actor.userId ?? null}::uuid
      WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND (${agentId}::uuid IS NULL OR agent_id = ${agentId}::uuid)
        AND state = ANY(${states}::text[]) AND expires_at > now()
      RETURNING id, org_id, agent_id, request_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, actor_agent_id, type, detail)
      SELECT org_id, ${actor.userId ?? null}::uuid, agent_id, 'operation.cancelled', jsonb_build_object('operation_id', id, 'request_id', request_id)
      FROM o
    )
    SELECT id FROM o`;
  if (rows.length === 0)
    throw new HttpError(
      409,
      "RW_REPLAY_001",
      agentId
        ? "Agents can only withdraw operations pending approval; an authorization keeps its budget until it expires"
        : "Operation cannot be cancelled: it is not an unexpired authorization or pending approval",
    );
  return getOperation(orgId, id);
}

export async function listOperations(ctx: MemberContext, params: URLSearchParams) {
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 200);
  const before = params.get("before");
  const agentId = params.get("agent_id");
  const decision = params.get("decision");
  const reason = params.get("reason_code");
  if (before !== null && Number.isNaN(Date.parse(before))) throw new BadRequest("before must be an ISO timestamp");
  if (agentId !== null && !/^[0-9a-f-]{36}$/i.test(agentId)) throw new BadRequest("agent_id is malformed");
  if (decision !== null && !["ALLOW", "DENY", "REQUIRES_HUMAN_SIGNATURE"].includes(decision)) throw new BadRequest("decision is malformed");
  if (reason !== null && !/^RW_[A-Z]+_\d{3}$/.test(reason)) throw new BadRequest("reason_code is malformed");
  const rows = await db()`
    SELECT o.*, p.policy_key, a.name AS agent_name, u.address AS decided_by_address
    FROM operations o JOIN agents a ON a.id = o.agent_id
    LEFT JOIN policies p ON p.id = o.policy_id LEFT JOIN users u ON u.id = o.decided_by
    WHERE o.org_id = ${ctx.orgId}::uuid
      AND (${before}::timestamptz IS NULL OR o.created_at < ${before}::timestamptz)
      AND (${agentId}::uuid IS NULL OR o.agent_id = ${agentId}::uuid)
      AND (${decision}::text IS NULL OR o.decision = ${decision}::text)
      AND (${reason}::text IS NULL OR o.reason_code = ${reason}::text)
    ORDER BY o.created_at DESC LIMIT ${limit}::int`;
  const operations = rows.map(toDecision);
  return { operations, next_before: rows.length === limit ? operations[operations.length - 1]!.created_at : null };
}

/** Dashboard numbers from the ledger: real observations only, last 24 hours, UTC. */
export async function summary(ctx: MemberContext) {
  const [s] = await db()`
    SELECT
      count(*) FILTER (WHERE decision = 'ALLOW')::int AS allowed,
      count(*) FILTER (WHERE decision = 'DENY')::int AS denied,
      count(*) FILTER (WHERE decision = 'REQUIRES_HUMAN_SIGNATURE')::int AS reviewed,
      count(*) FILTER (WHERE state = 'pending_approval' AND expires_at > now())::int AS pending_approvals,
      coalesce(sum(usd_micros) FILTER (WHERE created_at > now() - interval '1 hour' AND rw_holds_budget(state, expires_at)), 0)::text AS reserved_last_hour_usd_micros
    FROM operations WHERE org_id = ${ctx.orgId}::uuid AND created_at > now() - interval '24 hours'`;
  const hourly = await db()`
    SELECT date_trunc('hour', created_at) AS hour,
      count(*) FILTER (WHERE decision = 'ALLOW')::int AS allowed,
      count(*) FILTER (WHERE decision = 'DENY')::int AS denied,
      count(*) FILTER (WHERE decision = 'REQUIRES_HUMAN_SIGNATURE')::int AS reviewed
    FROM operations WHERE org_id = ${ctx.orgId}::uuid AND created_at > now() - interval '24 hours'
    GROUP BY 1 ORDER BY 1`;
  const reasons = await db()`
    SELECT reason_code, count(*)::int AS count FROM operations
    WHERE org_id = ${ctx.orgId}::uuid AND created_at > now() - interval '24 hours' AND decision = 'DENY'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
  return { window: "24h", timezone: "UTC", interval: "1h", ...s, hourly, deny_reasons: reasons };
}

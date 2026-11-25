import "server-only";
import { McpServer } from "@modelcontextprotocol/server";
import { REASON_CODES, RETRYABLE, validatePolicy, type ReasonCode } from "@palisec/policy-schema";
import { z } from "zod";
import type { AgentContext, Scope } from "./access";
import { cancel as cancelOperation } from "./approvals";
import { afterOperation } from "./events";
import { BadRequest, HttpError, logEvent } from "./http";
import { boundPolicy, ownAuditEvents, whoAmI } from "./integrations";
import { createOperation, dryRun, getOperation, parseIntent, testDraft } from "./operations";

/*
 * The official Palisec MCP server (spec 2.0 §18). MCP is only an interface: every tool calls the
 * same server functions as the REST API, under the same API key, scopes, tenant boundary, rate
 * limits and audit. There is no policy activation, no approval and no signing tool. A model that
 * reads a decision cannot turn it into an authorization; only the recorded operation can.
 */

export const MCP_VERSION = "1.0.0";

const intentShape = z.object({
  request_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).describe("Unique per intended transaction; reusing it returns the original decision"),
  chain_id: z.number().int().describe("The agent's own network: 4663 (Robinhood Chain mainnet, when enabled) or 46630 (Robinhood Chain Testnet)"),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe("Target contract or recipient"),
  value_wei: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).describe("Native value in wei, as a decimal string"),
  data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/).default("0x").describe("Calldata, 0x-prefixed hex"),
  gas_limit: z.number().int().min(21000).max(30_000_000).describe("Gas you will send with; the fee bound is gas_limit x gas price"),
  deadline: z.number().int().describe("Unix seconds after which the request is stale (at most one hour ahead)"),
});

const opId = z.object({ operation_id: z.string().uuid() });

type Result = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const json = (value: unknown): Result => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  structuredContent: (value && typeof value === "object" && !Array.isArray(value) ? value : { result: value }) as Record<string, unknown>,
});

/** Errors become tool results with the stable code, so the calling model sees why. */
function failure(err: unknown): Result {
  const e =
    err instanceof HttpError
      ? { code: err.code, message: err.message, retryable: err.retryable }
      : err instanceof BadRequest
        ? { code: "PS_REQUEST_001", message: err.message, retryable: false }
        : { code: "PS_STATE_001", message: "Authoritative state unavailable", retryable: true };
  return { content: [{ type: "text", text: JSON.stringify({ error: e }) }], structuredContent: { error: e }, isError: true };
}

function explain(op: NonNullable<Awaited<ReturnType<typeof getOperation>>>) {
  const failed = op.checks.find((c) => c.status === "fail");
  const review = op.checks.find((c) => c.status === "review");
  const code = op.reason_code as ReasonCode | null;
  return {
    operation_id: op.operation_id,
    decision: op.decision,
    state: op.state,
    reason_code: code,
    reason: code ? REASON_CODES[code] : null,
    deciding_check: failed ?? review ?? null,
    retryable: code ? RETRYABLE[code] : false,
    policy_version: op.policy_version,
    what_to_do:
      op.decision === "ALLOW"
        ? "Authorized. Send the exact transaction before expires_at; any change needs a new request."
        : op.decision === "REQUIRES_HUMAN_SIGNATURE"
          ? "Held for a human approver. Poll palisec_get_approval_status; do not send until state is approved."
          : code && RETRYABLE[code]
            ? "Denied for a condition that can clear (budget, rate, price, pause). Retry later with a new request_id."
            : "Denied by policy. Do not send. Changing the request will not help unless the policy allows it.",
  };
}

export function buildMcpServer(agent: AgentContext) {
  const server = new McpServer({ name: "palisec", version: MCP_VERSION });

  const tool = <S extends z.ZodType>(
    name: string,
    scope: Scope,
    description: string,
    inputSchema: S,
    run: (input: z.infer<S>) => Promise<unknown>,
    annotations: { readOnlyHint?: boolean; idempotentHint?: boolean; destructiveHint?: boolean } = {},
  ) =>
    server.registerTool(name, { description, inputSchema: inputSchema as never, annotations }, (async (input: unknown) => {
      // The key's scopes are checked on the server for every call, not by the tool list.
      if (!agent.scopes.includes(scope)) return failure(new HttpError(403, "PS_AUTH_001", `This API key does not have the ${scope} scope`));
      const started = Date.now();
      try {
        const out = await run(input as z.infer<S>);
        logEvent("info", "mcp.tool", { tool: name, agent_id: agent.agentId, ok: true, ms: Date.now() - started });
        return json(out);
      } catch (err) {
        logEvent("info", "mcp.tool", { tool: name, agent_id: agent.agentId, ok: false, ms: Date.now() - started });
        return failure(err);
      }
    }) as never);

  tool("palisec_get_account", "policy:read", "Who this API key is: agent, protected account, chain, scopes, bound policy and emergency-stop state.", z.object({}), () => whoAmI(agent), { readOnlyHint: true });

  tool("palisec_get_policy", "policy:read", "The exact active policy version this agent is evaluated against.", z.object({}), () => boundPolicy(agent), { readOnlyHint: true });

  tool(
    "palisec_evaluate_transaction",
    "operations:write",
    "Dry run: what Palisec would decide for this transaction now. Reserves nothing, records nothing, never authorizes.",
    intentShape,
    (i) => dryRun(agent, parseIntent(i)),
    { readOnlyHint: true },
  );

  tool(
    "palisec_propose_transaction",
    "operations:write",
    "Ask Palisec to authorize this transaction. Records the decision (ALLOW, DENY or REQUIRES_HUMAN_SIGNATURE) with its budget reservation. Send the transaction only if decision is ALLOW. Retrying with the same request_id returns the original decision.",
    intentShape,
    async (i) => {
      const { body, replayed } = await createOperation(agent, parseIntent(i), i.request_id);
      afterOperation(agent.orgId, body as unknown as Record<string, unknown>, replayed, agent.chainId);
      return { ...body, idempotent_replay: replayed };
    },
    { idempotentHint: true },
  );

  tool("palisec_get_transaction_status", "operations:read", "Current state of one of this agent's operations.", opId, async ({ operation_id }) => {
    const op = await getOperation(agent.orgId, operation_id, agent.agentId);
    if (!op) throw new HttpError(404, "PS_REQUEST_001", "Operation not found for this agent");
    return op;
  }, { readOnlyHint: true });

  tool("palisec_get_approval_status", "operations:read", "Whether a held operation was approved, rejected, withdrawn or expired.", opId, async ({ operation_id }) => {
    const op = await getOperation(agent.orgId, operation_id, agent.agentId);
    if (!op) throw new HttpError(404, "PS_REQUEST_001", "Operation not found for this agent");
    return {
      operation_id,
      state: op.state,
      approved: op.state === "approved",
      authorization_id: op.authorization_id,
      expires_at: op.expires_at,
      decided_at: op.details.decided_at,
    };
  }, { readOnlyHint: true });

  tool(
    "palisec_request_human_approval",
    "operations:read",
    "Approval is required by policy, not requested by the caller. For an operation already held for approval, returns where approvers act and its current state. It cannot approve anything.",
    opId,
    async ({ operation_id }) => {
      const op = await getOperation(agent.orgId, operation_id, agent.agentId);
      if (!op) throw new HttpError(404, "PS_REQUEST_001", "Operation not found for this agent");
      if (op.state !== "pending_approval") return { operation_id, state: op.state, message: "This operation is not waiting for approval." };
      return { operation_id, state: op.state, expires_at: op.expires_at, approvers_act_at: `/console/approvals?op=${operation_id}`, message: "An approver must sign this exact operation with their own wallet in the Palisec console." };
    },
    { readOnlyHint: true },
  );

  tool(
    "palisec_withdraw_approval_request",
    "operations:write",
    "Withdraw this agent's own operation that is still waiting for approval. Authorized operations keep their budget until they expire.",
    opId,
    ({ operation_id }) => cancelOperation(agent.orgId, operation_id, { agent }),
    { destructiveHint: true },
  );

  tool("palisec_explain_authorization", "operations:read", "Why an operation got its decision: the deciding check, the reason code and what to do next.", opId, async ({ operation_id }) => {
    const op = await getOperation(agent.orgId, operation_id, agent.agentId);
    if (!op) throw new HttpError(404, "PS_REQUEST_001", "Operation not found for this agent");
    return explain(op);
  }, { readOnlyHint: true });

  tool(
    "palisec_get_audit_events",
    "audit:read",
    "Audit events this agent caused, newest first.",
    z.object({ limit: z.number().int().min(1).max(100).default(20), before: z.string().regex(/^\d{1,18}$/).optional() }),
    ({ limit, before }) => ownAuditEvents(agent, new URLSearchParams({ limit: String(limit), ...(before ? { before } : {}) })),
    { readOnlyHint: true },
  );

  tool(
    "palisec_validate_policy",
    "policy:read",
    "Validate a policy document against the canonical schema 1.0. Does not save or activate anything.",
    z.object({ document: z.record(z.string(), z.unknown()) }),
    async ({ document }) => {
      const errors = validatePolicy(document);
      return { valid: errors.length === 0, errors };
    },
    { readOnlyHint: true },
  );

  tool(
    "palisec_simulate_policy",
    "policy:read",
    "Evaluate a policy draft against one transaction with live fee and price inputs and an empty ledger. Nothing is saved, reserved or activated.",
    z.object({ document: z.record(z.string(), z.unknown()), transaction: intentShape.partial() }),
    ({ document, transaction }) => testDraft(document, transaction),
    { readOnlyHint: true },
  );

  return server;
}

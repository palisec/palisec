import "server-only";
import { REASON_CODES, RETRYABLE, validatePolicy, type ReasonCode } from "@palisec/policy-schema";
import { z } from "zod";
import { ENDPOINTS } from "@/lib/api-reference";
import { ROLES, type AgentContext, type MemberContext, type Permission } from "../access";
import { listOperations, summary } from "../approvals";
import { chainEnabled } from "../config";
import { getAgent, getOrganization, getPolicy, listAudit, starterPolicy } from "../control";
import { db, type Row } from "../db";
import { policyChanges } from "../diff";
import { HttpError } from "../http";
import { listIntegrations } from "../integrations";
import { dryRun, getOperation, parseIntent, testDraft } from "../operations";
import { CATEGORIES, detect, listFindings, raiseFinding } from "../security-events";

/*
 * The PALISEC Agent's tools (spec 2.0 §14). Each has a strict input schema, a risk class, a minimum
 * autonomy level and a role. Availability is decided on the server for the signed-in member; a model
 * that names a tool it was not given is refused. Every query is scoped to the member's organization,
 * and identifiers from the model are checked against it. No tool signs, activates a policy, approves,
 * changes agent configuration or reaches the database directly. Actions only create a request that
 * a member must confirm in the console.
 */

export type Risk = "read" | "draft" | "action";
export interface Evidence {
  type: "operation" | "policy" | "agent" | "audit_event" | "finding" | "action_request" | "documentation";
  id: string;
  label?: string;
}
export interface ToolContext {
  member: MemberContext;
  runId: string;
}
export interface ToolResult {
  output: unknown;
  evidence?: Evidence[];
  actionRequestId?: string;
}
export interface Tool {
  name: string;
  description: string;
  risk: Risk;
  minAutonomy: 0 | 1 | 2;
  permission: Permission;
  schema: z.ZodType;
  run(ctx: ToolContext, input: never): Promise<ToolResult>;
}

const define = <S extends z.ZodType>(t: Omit<Tool, "schema" | "run"> & { schema: S; run(ctx: ToolContext, input: z.infer<S>): Promise<ToolResult> }) => t as unknown as Tool;

const uuid = z.string().uuid();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const opRef = z.object({ operation_id: uuid.describe("Operation ID") });
const usd = (n: number) => `$${(n / 1e6).toFixed(2)}`;

/** An operation as the model sees it: no calldata, only its selector and size. */
function brief(op: NonNullable<Awaited<ReturnType<typeof getOperation>>>) {
  return {
    operation_id: op.operation_id,
    request_id: op.request_id,
    agent: op.details.agent_name,
    agent_id: op.agent_id,
    decision: op.decision,
    state: op.state,
    reason_code: op.reason_code,
    message: op.message,
    policy: op.policy_id,
    policy_version: op.policy_version,
    target: op.details.target,
    value_wei: op.details.value_wei,
    selector: op.details.selector,
    calldata_bytes: typeof op.details.data === "string" ? (op.details.data.length - 2) / 2 : null,
    exposure_usd: usd(Number(op.details.exposure_usd_micros ?? 0)),
    created_at: op.created_at,
    expires_at: op.expires_at,
    decided_by: op.details.decided_by,
  };
}

async function operation(ctx: ToolContext, id: string) {
  const op = await getOperation(ctx.member.orgId, id);
  if (!op) throw new HttpError(404, "PS_REQUEST_001", "No such operation in this organization");
  return op;
}

/** An agent as a dry-run principal: same checks as its API key, without any credential. */
async function agentContext(orgId: string, agentId: string): Promise<AgentContext> {
  const [r] = await db()`
    SELECT a.id, a.org_id, a.name, a.status, a.chain_id, a.account, a.policy_id, a.upoch_workflow_id, o.emergency_stop
    FROM agents a JOIN organizations o ON o.id = a.org_id WHERE a.id = ${agentId}::uuid AND a.org_id = ${orgId}::uuid`;
  if (!r) throw new HttpError(404, "PS_REQUEST_001", "No such agent in this organization");
  return { credentialId: "", scopes: [], agentId: r.id, orgId: r.org_id, agentName: r.name, agentStatus: r.status, chainId: Number(r.chain_id), account: r.account, policyId: r.policy_id, emergencyStop: r.emergency_stop, upochWorkflowId: r.upoch_workflow_id ?? null };
}

/** Plain-language reading of a canonical policy, derived from the document itself. */
export function explainPolicy(doc: Record<string, any>): string[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const errors = validatePolicy(doc);
  if (errors.length) return [`This document is not a valid schema 1.0 policy: ${errors[0]!.path} ${errors[0]!.message}. An invalid policy never allows anything.`];
  const l = doc.limits;
  const out = [
    `Protects account ${doc.account.address} on chain ${doc.account.chain_id}. Status: ${doc.status}. Failure mode: closed (any missing input denies).`,
    `Per transaction: at most ${l.max_transaction_value_wei} wei of native value and ${l.max_gas_cost_wei} wei of fee.`,
    `Budget: ${usd(Number(l.hourly_budget_usd_micros))} per rolling hour (value + fee in USD at a price at most ${l.max_price_age_seconds}s old). Schema 1.0 has no daily budget.`,
    `At most ${l.max_pending_operations} operations may be pending at once.`,
    `Loops: identical calldata is refused for ${doc.cooldowns.identical_calldata_seconds}s, the same intent for ${doc.cooldowns.identical_intent_seconds}s.`,
    doc.contracts.allowlist.length
      ? `Allowed contracts (everything else is denied): ${doc.contracts.allowlist.map((e: { address: string; selectors: string[]; require_verified_code: boolean }) => `${e.address} [${e.selectors.join(", ") || "no methods"}]${e.require_verified_code ? " (code required)" : ""}`).join("; ")}.`
      : "No contract is allowed yet: every call is denied.",
    doc.contracts.denylist.length ? `Always denied, even if allowlisted: ${doc.contracts.denylist.join(", ")}.` : "No explicit denylist.",
    `A human approver must sign anything worth ${usd(Number(doc.human_approval.usd_threshold_micros))} or more.`,
    doc.human_approval.require_for_unknown_methods ? "Unknown methods on allowed contracts go to a human approver." : "Unknown methods on allowed contracts are denied.",
  ];
  return out;
}


const SDK_DOCS = {
  typescript: {
    install: "npm install @palisec/sdk viem (or: npm install https://palisec.tech/sdk/palisec-sdk-0.6.2.tgz viem)",
    methods: [
      "createPalisec({ apiKey }) -> client",
      "authorize(intent) -> decision record (ALLOW | DENY | REQUIRES_HUMAN_SIGNATURE); retry-safe",
      "evaluate(intent) -> dry run",
      "sendTransaction(wallet, intent, { waitForApproval }) -> sends with viem/ethers only on ALLOW",
      "getOperation(id), waitForApproval(id), cancel(id)",
      "transactions.evaluate / transactions.propose / transactions.get (aliases)",
      "policy.get() -> bound policy version; audit.list() -> own audit events; whoAmI()",
      "verifyWebhook(secret, rawBody, headers) -> checks a Palisec webhook signature",
    ],
    docs: "https://palisec.tech/docs/sdk/typescript",
  },
  python: {
    install: "pip install palisec (or: pip install https://palisec.tech/sdk/palisec-0.4.1-py3-none-any.whl)",
    methods: [
      "Palisec(api_key) async client",
      "authorize(**intent), evaluate(**intent), send_transaction(sender, ...)",
      "get_operation, wait_for_approval, cancel",
      "get_policy(), list_audit_events(), who_am_i()",
      "palisec.webhooks.verify(secret, raw_body, headers)",
    ],
    docs: "https://palisec.tech/docs/sdk/python",
  },
  mcp: {
    install: "Remote MCP server at https://palisec.tech/api/mcp (Streamable HTTP). Authorization: Bearer <agent API key with the mcp scope>.",
    methods: ["palisec_get_account", "palisec_get_policy", "palisec_evaluate_transaction", "palisec_propose_transaction", "palisec_get_transaction_status", "palisec_get_approval_status", "palisec_explain_authorization", "palisec_get_audit_events", "palisec_validate_policy", "palisec_simulate_policy"],
    docs: "https://palisec.tech/docs/mcp",
  },
} as const;

const GUIDANCE: Partial<Record<ReasonCode, string>> = {
  PS_AUTH_001: "The API key is missing, revoked, or lacks the scope. Create or rotate a key in Console -> Agents.",
  PS_POLICY_001: "No valid active policy, the sender is not the protected account, or the policy is disabled. Activate a valid policy and bind it to the agent.",
  PS_POLICY_002: "The target is on the explicit denylist. Deny always wins; remove it from the denylist only if that is intended.",
  PS_TARGET_001: "The target contract is not allowlisted (or requires deployed code that is missing), or the chain does not match.",
  PS_METHOD_001: "The function selector is not allowed for this contract. Add it to the allowlist entry if intended.",
  PS_BUDGET_001: "A value, fee or hourly budget limit would be exceeded. Wait for reservations to expire or raise the limit in a new policy version.",
  PS_RATE_001: "Too many pending operations or requests. Wait, or withdraw pending approvals.",
  PS_LOOP_001: "The same calldata or intent was seen within its cooldown. This protects against loops; send a different request later.",
  PS_REPLAY_001: "The request_id was reused or the deadline passed. Use a new request_id and a future deadline.",
  PS_FEE_001: "The fee could not be estimated (RPC unavailable). Unknown fees are never treated as zero; retry later.",
  PS_HUMAN_001: "A human approver must sign this exact operation in Console -> Approvals.",
  PS_PAUSED_001: "The agent is paused or the organization's emergency stop is engaged.",
  PS_STATE_001: "Authoritative state, price or the policy engines were unavailable or disagreed; the request failed closed. Retry later.",
  PS_CHAIN_001: "The network is not enabled on this deployment (testnet 46630 always; mainnet 4663 only when the operator turns it on), or smart-account execution is not configured for it.",
  PS_REQUEST_001: "The request did not match the schema. Check field formats against the API reference.",
};

async function actionRequest(ctx: ToolContext, action: "emergency_stop" | "agent_pause" | "policy_draft", params: Record<string, unknown>, impact: string) {
  const [r] = await db()`
    WITH a AS (
      INSERT INTO agent_action_requests (org_id, run_id, action, params, impact)
      SELECT ${ctx.member.orgId}::uuid, id, ${action}, ${JSON.stringify(params)}::text::jsonb, ${impact.slice(0, 600)}
      FROM agent_runs WHERE id = ${ctx.runId}::uuid AND org_id = ${ctx.member.orgId}::uuid
      RETURNING id, org_id, expires_at
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT org_id, ${ctx.member.user.userId}::uuid, 'agent.action_requested', jsonb_build_object('action_request_id', id, 'action', ${action}::text, 'agent_run_id', ${ctx.runId}::text) FROM a
    )
    SELECT id, expires_at FROM a`;
  if (!r) throw new HttpError(404, "PS_REQUEST_001", "Run not found");
  return {
    output: { action_request_id: r.id, status: "pending_confirmation", expires_at: r.expires_at, impact, note: "Nothing has changed. A member with the required role must confirm this request in the PALISEC Agent console." },
    evidence: [{ type: "action_request" as const, id: r.id as string, label: action }],
    actionRequestId: r.id as string,
  };
}

export const TOOLS: Tool[] = [
  // ------------------------------------------------------------------ investigation (read only)
  define({
    name: "get_account_security_state",
    description: "Organization-wide security state: emergency stop, agents by status, policies, pending approvals, open findings and 24-hour decision counts.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({}),
    async run(ctx) {
      const [org, s, agents] = await Promise.all([
        getOrganization(ctx.member),
        summary(ctx.member) as Promise<Row>,
        db()`SELECT status, count(*)::int AS n FROM agents WHERE org_id = ${ctx.member.orgId}::uuid GROUP BY status`,
      ]);
      const [f] = await db()`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'open' AND severity = 'critical')::int AS critical FROM security_findings WHERE org_id = ${ctx.member.orgId}::uuid`;
      return {
        output: {
          emergency_stop: (org as { emergency_stop?: boolean }).emergency_stop,
          agents: Object.fromEntries(agents.map((a) => [a.status, a.n])),
          last_24h: { allowed: s.allowed, denied: s.denied, reviewed: s.reviewed, deny_reasons: s.deny_reasons },
          pending_approvals: s.pending_approvals,
          reserved_last_hour_usd: usd(Number(s.reserved_last_hour_usd_micros)),
          open_findings: f?.open ?? 0,
          critical_findings: f?.critical ?? 0,
        },
      };
    },
  }),
  define({
    name: "get_agent_profile",
    description: "One registered agent (integration): account, bound policy, status, keys (prefixes and scopes only) and last-hour activity.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ agent_id: uuid }),
    async run(ctx, { agent_id }) {
      const a = (await getAgent(ctx.member, agent_id)) as Row;
      const creds = (a.credentials as { prefix: string; label: string; scopes?: string[]; revoked_at: string | null; last_used_at: string | null }[]).map((c) => ({ label: c.label, prefix: c.prefix, scopes: c.scopes, revoked: Boolean(c.revoked_at), last_used_at: c.last_used_at }));
      return {
        output: { id: a.id, name: a.name, framework: a.framework ?? null, status: a.status, chain_id: a.chain_id, account: a.account, policy: a.policy_key, policy_version: a.policy_version, last_hour: a.last_hour, keys: creds },
        evidence: [{ type: "agent", id: agent_id, label: String(a.name) }],
      };
    },
  }),
  define({
    name: "get_policy",
    description: "A policy: active version document, draft status and a plain-language explanation.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ policy_id: uuid }),
    async run(ctx, { policy_id }) {
      const p = await getPolicy(ctx.member, policy_id);
      return {
        output: { id: p.id, policy_key: p.policy_key, name: p.name, status: p.status, active_version: p.active_version, active_document: p.active_document, explanation: p.active_document ? explainPolicy(p.active_document) : null, draft_valid: p.draft ? p.draft_errors.length === 0 : null },
        evidence: [{ type: "policy", id: policy_id, label: `${p.policy_key} v${p.active_version ?? "draft"}` }],
      };
    },
  }),
  define({
    name: "list_policy_versions",
    description: "List policies in the organization, or the version history of one policy.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ policy_id: uuid.optional() }),
    async run(ctx, { policy_id }) {
      if (!policy_id) {
        const rows = await db()`SELECT id, policy_key, name, active_version, (disabled_at IS NOT NULL) AS disabled FROM policies WHERE org_id = ${ctx.member.orgId}::uuid ORDER BY created_at`;
        return { output: { policies: rows }, evidence: rows.map((r) => ({ type: "policy" as const, id: r.id as string, label: r.policy_key as string })) };
      }
      const p = await getPolicy(ctx.member, policy_id);
      return { output: { policy_key: p.policy_key, active_version: p.active_version, versions: (p.versions as Row[]).map((v) => ({ version: v.version, activated_at: v.activated_at, activated_by: v.activated_by, document_hash: v.document_hash })) }, evidence: [{ type: "policy", id: policy_id, label: p.policy_key }] };
    },
  }),
  define({
    name: "get_transaction",
    description: "One operation (transaction proposal) and its recorded decision. Calldata is reduced to its selector and size.",
    risk: "read", minAutonomy: 0, permission: "read", schema: opRef,
    async run(ctx, { operation_id }) {
      const op = await operation(ctx, operation_id);
      return { output: brief(op), evidence: [{ type: "operation", id: operation_id, label: `${op.decision} ${op.reason_code ?? ""}`.trim() }] };
    },
  }),
  define({
    name: "list_transactions",
    description: "Recent operations, newest first, optionally filtered by decision, reason code or agent.",
    risk: "read", minAutonomy: 0, permission: "read",
    schema: z.object({
      decision: z.enum(["ALLOW", "DENY", "REQUIRES_HUMAN_SIGNATURE"]).optional(),
      reason_code: z.string().regex(/^PS_[A-Z]+_\d{3}$/).optional(),
      agent_id: uuid.optional(),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    async run(ctx, input) {
      const params = new URLSearchParams({ limit: String(input.limit) });
      if (input.decision) params.set("decision", input.decision);
      if (input.reason_code) params.set("reason_code", input.reason_code);
      if (input.agent_id) params.set("agent_id", input.agent_id);
      const { operations } = await listOperations(ctx.member, params);
      return { output: { operations: operations.map(brief) }, evidence: operations.map((o) => ({ type: "operation" as const, id: o.operation_id!, label: o.decision })) };
    },
  }),
  define({
    name: "get_authorization_decision",
    description: "Why an operation got its decision: every check in evaluation order, the deciding check, the reason code and its meaning.",
    risk: "read", minAutonomy: 0, permission: "read", schema: opRef,
    async run(ctx, { operation_id }) {
      const op = await operation(ctx, operation_id);
      const code = op.reason_code as ReasonCode | null;
      return {
        output: {
          ...brief(op),
          reason: code ? REASON_CODES[code] : null,
          guidance: code ? GUIDANCE[code] ?? null : null,
          retryable: code ? RETRYABLE[code] : false,
          checks: op.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })),
        },
        evidence: [{ type: "operation", id: operation_id, label: `${op.decision} ${op.reason_code ?? ""}`.trim() }],
      };
    },
  }),
  define({
    name: "get_execution_status",
    description: "Authorization and on-chain execution state of an operation. Execution is observed only for agents that execute through a PALISEC smart account.",
    risk: "read", minAutonomy: 0, permission: "read", schema: opRef,
    async run(ctx, { operation_id }) {
      const op = await operation(ctx, operation_id);
      return {
        output: {
          operation_id,
          authorization_state: op.state,
          authorization_id: op.authorization_id,
          expires_at: op.expires_at,
          execution: (op.details as { execution?: unknown } | undefined)?.execution ?? "not_observed (not executed through a PALISEC smart account; a plain-key agent sends by itself)",
          transaction_hash: op.transaction_hash ?? null,
        },
        evidence: [{ type: "operation", id: operation_id }],
      };
    },
  }),
  define({
    name: "get_approval_status",
    description: "Human-approval state of an operation: pending, approved (with authorization), rejected, withdrawn or expired, and who decided.",
    risk: "read", minAutonomy: 0, permission: "read", schema: opRef,
    async run(ctx, { operation_id }) {
      const op = await operation(ctx, operation_id);
      return {
        output: { operation_id, decision: op.decision, state: op.state, decided_by: op.details.decided_by, decided_at: op.details.decided_at, expires_at: op.expires_at, authorization_id: op.authorization_id },
        evidence: [{ type: "operation", id: operation_id }],
      };
    },
  }),
  define({
    name: "get_audit_events",
    description: "Append-only audit events, newest first, optionally by type prefix (for example 'policy', 'agent', 'operation') or agent.",
    risk: "read", minAutonomy: 0, permission: "read",
    schema: z.object({ type: z.string().regex(/^[a-z_.]{1,64}$/).optional(), agent_id: uuid.optional(), limit: z.number().int().min(1).max(30).default(15) }),
    async run(ctx, input) {
      const params = new URLSearchParams({ limit: String(input.limit) });
      if (input.type) params.set("type", input.type);
      if (input.agent_id) params.set("agent_id", input.agent_id);
      const events = (await listAudit(ctx.member, params)).events as Row[];
      return {
        output: { events: events.map((e) => ({ event_id: e.event_id, type: e.type, at: e.created_at, actor: e.actor_address ?? e.actor_agent_name ?? null, detail: e.detail })) },
        evidence: events.map((e) => ({ type: "audit_event" as const, id: e.event_id as string, label: e.type as string })),
      };
    },
  }),
  define({
    name: "get_security_events",
    description: "Security findings from the deterministic detectors (repeated denials, replays, unapproved contracts, budget thresholds, pauses, emergency stops) with their evidence.",
    risk: "read", minAutonomy: 0, permission: "read",
    schema: z.object({ status: z.enum(["open", "acknowledged", "resolved"]).optional(), category: z.enum(CATEGORIES).optional() }),
    async run(ctx, input) {
      // Asked explicitly, so detect now rather than reuse a recent run.
      await detect(ctx.member.orgId, true);
      const params = new URLSearchParams({ limit: "20" });
      if (input.status) params.set("status", input.status);
      if (input.category) params.set("category", input.category);
      const findings = await listFindings(ctx.member.orgId, params);
      return { output: { findings }, evidence: findings.map((f) => ({ type: "finding" as const, id: f.id as string, label: f.category as string })) };
    },
  }),
  define({
    name: "get_integration_status",
    description: "Integrations (registered agents) with key status, scopes, last activity, 24-hour requests and denials, and webhook health.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({}),
    async run(ctx) {
      const r = await listIntegrations(ctx.member);
      return { output: r, evidence: r.integrations.map((i) => ({ type: "agent" as const, id: i.id as string, label: i.name as string })) };
    },
  }),

  // ------------------------------------------------------------------ policy engineering (drafts only)
  define({
    name: "draft_policy",
    description:
      "Build a canonical schema-1.0 policy draft from structured requirements. Returns the document, validation and anything missing. Nothing is saved or activated. Budgets are per rolling hour (schema 1.0 has no daily budget).",
    risk: "draft", minAutonomy: 1, permission: "read",
    schema: z.object({
      policy_key: z.string().regex(/^[a-z0-9_]{3,64}$/),
      chain_id: z.number().int(),
      account: address,
      hourly_budget_usd: z.number().positive().max(10_000_000).optional(),
      approval_threshold_usd: z.number().min(0).max(10_000_000).optional(),
      max_transaction_value_wei: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).optional(),
      max_fee_wei: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).optional(),
      contracts: z.array(z.object({ address, selectors: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/)).max(64), require_verified_code: z.boolean().default(true) })).max(32).default([]),
      denylist: z.array(address).max(64).default([]),
      unknown_methods: z.enum(["review", "deny"]).default("review"),
      max_pending_operations: z.number().int().min(0).max(1000).optional(),
    }),
    async run(_ctx, i) {
      const doc = starterPolicy(i.policy_key, i.chain_id, i.account);
      const missing: string[] = [];
      if (i.hourly_budget_usd !== undefined) doc.limits.hourly_budget_usd_micros = String(Math.round(i.hourly_budget_usd * 1e6));
      else missing.push("hourly budget (kept the strict default $50/hour)");
      if (i.approval_threshold_usd !== undefined) doc.human_approval.usd_threshold_micros = String(Math.round(i.approval_threshold_usd * 1e6));
      else missing.push("approval threshold (kept the strict default $25)");
      if (i.max_transaction_value_wei) doc.limits.max_transaction_value_wei = i.max_transaction_value_wei;
      if (i.max_fee_wei) doc.limits.max_gas_cost_wei = i.max_fee_wei;
      if (i.max_pending_operations !== undefined) doc.limits.max_pending_operations = i.max_pending_operations;
      doc.contracts.allowlist = i.contracts.map((c) => ({ address: c.address as `0x${string}`, selectors: c.selectors.map((s) => s.toLowerCase() as `0x${string}`), require_verified_code: c.require_verified_code }));
      doc.contracts.denylist = i.denylist as `0x${string}`[];
      doc.human_approval.require_for_unknown_methods = i.unknown_methods === "review";
      if (!i.contracts.length) missing.push("allowed contracts (none: every call will be denied)");
      if (!chainEnabled(i.chain_id)) missing.push(`chain ${i.chain_id} is not enabled on this deployment`);
      const errors = validatePolicy(doc);
      return { output: { draft: doc, valid: errors.length === 0, errors, missing_information: missing, explanation: explainPolicy(doc as never), status: "draft (not saved, not active)" } };
    },
  }),
  define({
    name: "validate_policy",
    description: "Validate a policy document against the canonical schema 1.0.",
    risk: "draft", minAutonomy: 1, permission: "read", schema: z.object({ document: z.record(z.string(), z.unknown()) }),
    async run(_ctx, { document }) {
      const errors = validatePolicy(document);
      return { output: { valid: errors.length === 0, errors, explanation: errors.length ? null : explainPolicy(document) } };
    },
  }),
  define({
    name: "simulate_policy",
    description:
      "Evaluate a policy draft with live fee and price inputs and an empty ledger: either one transaction, or replay up to 10 recent operations of an agent and compare with what was recorded. Nothing is saved or reserved.",
    risk: "draft", minAutonomy: 1, permission: "read",
    schema: z.object({
      document: z.record(z.string(), z.unknown()),
      transaction: z.object({ to: address, value_wei: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).default("0"), data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/).default("0x"), gas_limit: z.number().int().min(21000).max(30_000_000).default(100000) }).optional(),
      replay_agent_id: uuid.optional(),
    }),
    async run(ctx, { document, transaction, replay_agent_id }) {
      if (!transaction && !replay_agent_id) throw new HttpError(400, "PS_REQUEST_001", "Give a transaction or replay_agent_id");
      if (transaction) {
        const r = await testDraft(document, transaction);
        return { output: { mode: "single", ...r } };
      }
      await agentContext(ctx.member.orgId, replay_agent_id!);
      const past = await db()`
        SELECT id, target, value_wei::text AS value_wei, data, gas_limit, decision, reason_code FROM operations
        WHERE org_id = ${ctx.member.orgId}::uuid AND agent_id = ${replay_agent_id}::uuid ORDER BY created_at DESC LIMIT 10`;
      const results = [];
      for (const p of past) {
        const r = await testDraft(document, { to: p.target, value_wei: p.value_wei, data: p.data, gas_limit: Number(p.gas_limit ?? 100000) });
        results.push({ operation_id: p.id, recorded: `${p.decision}${p.reason_code ? ` ${p.reason_code}` : ""}`, with_draft: `${r.decision}${r.reason_code ? ` ${r.reason_code}` : ""}`, changed: r.decision !== p.decision });
      }
      return { output: { mode: "replay", note: "Each operation is evaluated alone against live fee and price inputs and an empty ledger, so budgets and cooldowns across operations are not replayed.", results }, evidence: past.map((p) => ({ type: "operation" as const, id: p.id as string })) };
    },
  }),
  define({
    name: "compare_policy_versions",
    description: "Field-by-field differences between two versions of a policy, or between the active version and the current draft (to_version omitted).",
    risk: "read", minAutonomy: 0, permission: "read",
    schema: z.object({ policy_id: uuid, from_version: z.number().int().min(1), to_version: z.number().int().min(1).optional() }),
    async run(ctx, { policy_id, from_version, to_version }) {
      const rows = await db()`
        SELECT v.version, v.document, p.draft FROM policies p LEFT JOIN policy_versions v ON v.policy_id = p.id
        WHERE p.id = ${policy_id}::uuid AND p.org_id = ${ctx.member.orgId}::uuid`;
      if (!rows.length) throw new HttpError(404, "PS_REQUEST_001", "No such policy in this organization");
      const from = rows.find((r) => r.version === from_version)?.document;
      const to = to_version === undefined ? rows[0]!.draft : rows.find((r) => r.version === to_version)?.document;
      if (!from || !to) throw new HttpError(404, "PS_REQUEST_001", "Version not found");
      const changes = policyChanges(from, to);
      return { output: { policy_id, from: from_version, to: to_version ?? "draft", changes }, evidence: [{ type: "policy", id: policy_id }] };
    },
  }),
  define({
    name: "explain_policy",
    description: "Plain-language explanation of a policy document or of a policy's active version.",
    risk: "read", minAutonomy: 0, permission: "read",
    schema: z.object({ policy_id: uuid.optional(), document: z.record(z.string(), z.unknown()).optional() }),
    async run(ctx, { policy_id, document }) {
      if (document) return { output: { explanation: explainPolicy(document) } };
      if (!policy_id) throw new HttpError(400, "PS_REQUEST_001", "Give policy_id or document");
      const p = await getPolicy(ctx.member, policy_id);
      if (!p.active_document) return { output: { explanation: ["This policy has no active version; agents bound to it are denied (PS_POLICY_001)."] }, evidence: [{ type: "policy", id: policy_id }] };
      return { output: { policy_key: p.policy_key, version: p.active_version, explanation: explainPolicy(p.active_document) }, evidence: [{ type: "policy", id: policy_id, label: `${p.policy_key} v${p.active_version}` }] };
    },
  }),

  // ------------------------------------------------------------------ operations (prepare, then request)
  define({
    name: "prepare_emergency_stop",
    description: "What an organization-wide emergency stop would do now: agents and operations affected. Changes nothing.",
    risk: "read", minAutonomy: 1, permission: "read", schema: z.object({}),
    async run(ctx) {
      const [r] = await db()`
        SELECT (SELECT count(*) FROM agents WHERE org_id = ${ctx.member.orgId}::uuid AND status = 'active')::int AS active_agents,
          (SELECT count(*) FROM operations WHERE org_id = ${ctx.member.orgId}::uuid AND state = 'pending_approval' AND expires_at > now())::int AS pending,
          (SELECT count(*) FROM operations WHERE org_id = ${ctx.member.orgId}::uuid AND state IN ('authorized', 'approved') AND expires_at > now())::int AS live_authorizations,
          (SELECT emergency_stop FROM organizations WHERE id = ${ctx.member.orgId}::uuid) AS already`;
      return {
        output: {
          already_engaged: r!.already,
          impact: `Every new operation from ${r!.active_agents} active agent(s) would be denied with PS_PAUSED_001, and ${r!.pending} pending approval(s) could no longer be approved. ${r!.live_authorizations} unexpired authorization(s) already issued stay valid until they expire (Palisec does not sign, so it cannot recall them). Only an owner can lift the stop.`,
        },
      };
    },
  }),
  define({
    name: "request_emergency_stop",
    description: "Ask a member to engage the organization-wide emergency stop. Creates a request that must be confirmed in the console by an operator; nothing changes until then.",
    risk: "action", minAutonomy: 2, permission: "operate", schema: z.object({ reason: z.string().min(3).max(280) }),
    async run(ctx, { reason }) {
      return actionRequest(ctx, "emergency_stop", { reason }, `Engage the emergency stop: every new operation in this organization is denied until an owner lifts it. Reason given: ${reason}`);
    },
  }),
  define({
    name: "prepare_account_pause",
    description: "What pausing one agent would do now. Changes nothing.",
    risk: "read", minAutonomy: 1, permission: "read", schema: z.object({ agent_id: uuid }),
    async run(ctx, { agent_id }) {
      const a = await agentContext(ctx.member.orgId, agent_id);
      const [r] = await db()`SELECT count(*) FILTER (WHERE state = 'pending_approval' AND expires_at > now())::int AS pending FROM operations WHERE agent_id = ${agent_id}::uuid`;
      return {
        output: { agent: a.agentName, status: a.agentStatus, impact: `New operations from ${a.agentName} would be denied with PS_PAUSED_001 and its ${r!.pending} pending approval(s) could not be approved. Its keys stay valid; an admin can resume it.` },
        evidence: [{ type: "agent", id: agent_id, label: a.agentName }],
      };
    },
  }),
  define({
    name: "request_account_pause",
    description: "Ask a member to pause one agent. Creates a request that an operator must confirm in the console.",
    risk: "action", minAutonomy: 2, permission: "operate", schema: z.object({ agent_id: uuid, reason: z.string().min(3).max(280) }),
    async run(ctx, { agent_id, reason }) {
      const a = await agentContext(ctx.member.orgId, agent_id);
      if (a.agentStatus !== "active") throw new HttpError(409, "PS_REQUEST_001", `The agent is ${a.agentStatus}, not active`);
      return actionRequest(ctx, "agent_pause", { agent_id, reason }, `Pause agent ${a.agentName}: its new operations are denied until an admin resumes it. Reason given: ${reason}`);
    },
  }),
  define({
    name: "submit_policy_draft",
    description:
      "Ask a member to save a validated policy document as the draft of a new or existing policy. Saving a draft never activates it: activation stays a separate, reviewed step in the policy editor.",
    risk: "action", minAutonomy: 2, permission: "manage",
    schema: z.object({ name: z.string().min(1).max(80), document: z.record(z.string(), z.unknown()), policy_id: uuid.optional() }),
    async run(ctx, { name, document, policy_id }) {
      const errors = validatePolicy(document);
      if (errors.length) throw new HttpError(422, "PS_POLICY_001", `The draft is invalid: ${errors[0]!.path} ${errors[0]!.message}`);
      if (policy_id) await getPolicy(ctx.member, policy_id);
      return actionRequest(ctx, "policy_draft", { name, document, policy_id: policy_id ?? null }, `Save "${name}" as a policy draft${policy_id ? " (replacing the current draft)" : " (new policy)"}. It will not be active until a member reviews and activates it.`);
    },
  }),
  define({
    name: "request_human_approval",
    description: "Where approvers act on an operation held for human approval, and its state. Approval itself is always a person's signature.",
    risk: "read", minAutonomy: 0, permission: "read", schema: opRef,
    async run(ctx, { operation_id }) {
      const op = await operation(ctx, operation_id);
      return {
        output: { operation_id, state: op.state, expires_at: op.expires_at, where: `/console/approvals?op=${operation_id}`, note: op.state === "pending_approval" ? "An approver must sign this exact operation with their own wallet." : "This operation is not waiting for approval." },
        evidence: [{ type: "operation", id: operation_id }],
      };
    },
  }),
  define({
    name: "create_security_alert",
    description: "Raise a security finding with evidence (operation IDs from this organization). Recorded as created by the PALISEC Agent and sent to subscribed webhooks.",
    risk: "action", minAutonomy: 2, permission: "operate",
    schema: z.object({ category: z.enum(CATEGORIES), severity: z.enum(["info", "warning", "critical"]), title: z.string().min(5).max(160), operation_ids: z.array(uuid).min(1).max(20) }),
    async run(ctx, i) {
      const [c] = await db()`SELECT count(*)::int AS n FROM operations WHERE org_id = ${ctx.member.orgId}::uuid AND id = ANY(${i.operation_ids}::uuid[])`;
      if (c!.n !== new Set(i.operation_ids).size) throw new HttpError(404, "PS_REQUEST_001", "Every cited operation must exist in this organization");
      const r = await raiseFinding(ctx.member.orgId, { category: i.category, severity: i.severity, title: i.title, evidence: { operation_ids: i.operation_ids } }, "agent", ctx.runId);
      return { output: r, evidence: [...(r.id ? [{ type: "finding" as const, id: r.id as string }] : []), ...i.operation_ids.map((id) => ({ type: "operation" as const, id }))] };
    },
  }),

  // ------------------------------------------------------------------ transactions (dry run only)
  define({
    name: "evaluate_transaction",
    description: "Dry run: what Palisec would decide now for this transaction from a registered agent. Reserves nothing and records nothing. The agent's own API key is the only way to request a real authorization.",
    risk: "read", minAutonomy: 1, permission: "read",
    schema: z.object({ agent_id: uuid, to: address, value_wei: z.string().regex(/^(0|[1-9][0-9]{0,77})$/).default("0"), data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/).default("0x"), gas_limit: z.number().int().min(21000).max(30_000_000).default(100000) }),
    async run(ctx, i) {
      const agent = await agentContext(ctx.member.orgId, i.agent_id);
      const r = await dryRun(agent, parseIntent({ request_id: `agent_dry_${Date.now()}`, chain_id: agent.chainId, to: i.to, value_wei: i.value_wei, data: i.data, gas_limit: i.gas_limit, deadline: Math.floor(Date.now() / 1000) + 60 }));
      return { output: { decision: r.decision, reason_code: r.reason_code, message: r.message, checks: r.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })), dry_run: true }, evidence: [{ type: "agent", id: i.agent_id, label: agent.agentName }] };
    },
  }),

  // ------------------------------------------------------------------ developer assistance
  define({
    name: "explain_error_code",
    description: "Meaning of a PS_ reason code, whether retrying can help, and what to do.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ code: z.string().regex(/^PS_[A-Z]+_\d{3}$/) }),
    async run(_ctx, { code }) {
      const c = code as ReasonCode;
      if (!(c in REASON_CODES)) return { output: { code, known: false } };
      return { output: { code, meaning: REASON_CODES[c], retryable: RETRYABLE[c], guidance: GUIDANCE[c] ?? null }, evidence: [{ type: "documentation", id: "/docs/errors", label: code }] };
    },
  }),
  define({
    name: "get_api_documentation",
    description: "REST endpoints matching a topic (path, group or summary), with auth and role.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ topic: z.string().min(2).max(60) }),
    async run(_ctx, { topic }) {
      const t = topic.toLowerCase();
      const hits = ENDPOINTS.flatMap((g) => g.items.map((e) => ({ group: g.group, ...e }))).filter((e) => `${e.group} ${e.path} ${e.summary}`.toLowerCase().includes(t)).slice(0, 15);
      return { output: { base_url: "https://palisec.tech/api/v1", endpoints: hits, openapi: "/api/v1/openapi.json" }, evidence: [{ type: "documentation", id: "/docs/api" }] };
    },
  }),
  define({
    name: "get_sdk_documentation",
    description: "How to install and use the TypeScript SDK, the Python SDK or the MCP server.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ surface: z.enum(["typescript", "python", "mcp"]) }),
    async run(_ctx, { surface }) {
      return { output: SDK_DOCS[surface], evidence: [{ type: "documentation", id: SDK_DOCS[surface].docs }] };
    },
  }),
  define({
    name: "generate_integration_example",
    description: "A working integration example with placeholders for secrets (never real keys).",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ surface: z.enum(["typescript", "python", "mcp", "curl"]) }),
    async run(_ctx, { surface }) {
      const examples = {
        typescript: `import { createPalisec, PalisecDeniedError } from "@palisec/sdk";\n\nconst palisec = createPalisec({ apiKey: process.env.PALISEC_API_KEY! });\ntry {\n  const { operation, hash } = await palisec.sendTransaction(wallet, { to: TOKEN, data, gasLimit: 90_000 });\n  if (!hash) console.log("held for approval", operation.operationId);\n} catch (e) {\n  if (e instanceof PalisecDeniedError) console.warn(e.code); else throw e;\n}`,
        python: `import os\nfrom palisec import Palisec, PalisecDeniedError\n\nasync with Palisec(os.environ["PALISEC_API_KEY"]) as palisec:\n    try:\n        r = await palisec.send_transaction(sender, to=TOKEN, data=calldata, gas_limit=90_000)\n    except PalisecDeniedError as e:\n        print(e.code)`,
        mcp: JSON.stringify({ mcpServers: { palisec: { type: "http", url: "https://palisec.tech/api/mcp", headers: { Authorization: "Bearer ${PALISEC_API_KEY}" } } } }, null, 2),
        curl: `curl -s https://palisec.tech/api/v1/authorizations/evaluate \\\n  -H "authorization: Bearer $PALISEC_API_KEY" -H "content-type: application/json" \\\n  -d '{"request_id":"try-1","chain_id":46630,"to":"0x…","value_wei":"0","data":"0x","gas_limit":21000,"deadline":'$(($(date +%s)+60))'}'`,
      };
      return { output: { surface, code: examples[surface], note: "Keep PALISEC_API_KEY in your server's secret store. Never put it in code or a browser." } };
    },
  }),
  define({
    name: "inspect_integration_health",
    description: "Health of one integration: key status and scopes, last activity, and its most common denial reasons in 24 hours.",
    risk: "read", minAutonomy: 0, permission: "read", schema: z.object({ agent_id: uuid }),
    async run(ctx, { agent_id }) {
      const a = (await getAgent(ctx.member, agent_id)) as Row;
      const reasons = await db()`
        SELECT reason_code, count(*)::int AS n FROM operations WHERE agent_id = ${agent_id}::uuid AND org_id = ${ctx.member.orgId}::uuid
          AND decision = 'DENY' AND created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`;
      const keys = (a.credentials as { revoked_at: string | null; last_used_at: string | null; scopes?: string[]; prefix: string }[]).filter((c) => !c.revoked_at);
      return {
        output: {
          agent: a.name,
          status: a.status,
          policy: a.policy_key ? `${a.policy_key} v${a.policy_version}` : "none bound (every request is denied with PS_POLICY_001)",
          active_keys: keys.map((k) => ({ prefix: k.prefix, scopes: k.scopes, last_used_at: k.last_used_at })),
          last_hour: a.last_hour,
          top_denials_24h: reasons.map((r) => ({ ...r, guidance: GUIDANCE[r.reason_code as ReasonCode] ?? null })),
        },
        evidence: [{ type: "agent", id: agent_id, label: String(a.name) }],
      };
    },
  }),
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

/** Tools this member may use at this autonomy level. The model is shown only these. */
export function availableTools(member: MemberContext, autonomy: number, disabled: string[]): Tool[] {
  return TOOLS.filter((t) => t.minAutonomy <= autonomy && (ROLES[t.permission] as readonly string[]).includes(member.role) && !disabled.includes(t.name));
}

export function toolSpec(t: Tool) {
  const schema = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
  delete schema.$schema;
  return { type: "function" as const, function: { name: t.name, description: t.description, parameters: schema } };
}

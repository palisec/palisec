/**
 * The REST surface, in one place: the API reference page renders it and /api/v1/openapi.json serves
 * it as OpenAPI 3.1. Keep it in step with apps/web/src/app/api/v1.
 */

export type Auth = "none" | "session" | "key" | "session or key";

export interface Endpoint {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: Auth;
  role?: "viewer" | "operator" | "approver" | "admin" | "owner";
  summary: string;
  body?: Record<string, string>;
  notes?: string;
}

export const ENDPOINTS: { group: string; items: Endpoint[] }[] = [
  {
    group: "Authorization (agents)",
    items: [
      {
        method: "POST",
        path: "/operations",
        auth: "key",
        summary: "Evaluate a transaction intent and record the decision with its budget reservation.",
        body: {
          request_id: "string, 1-128 of A-Z a-z 0-9 _ . : -; unique per agent",
          chain_id: "integer; 46630 (Robinhood Chain Testnet)",
          to: "address",
          value_wei: "decimal integer string",
          data: "0x hex calldata, at most 65536 bytes; \"0x\" for a native transfer",
          gas_limit: "integer 21000-30000000; fee bound = gas_limit × current gas price",
          deadline: "unix seconds, at most one hour ahead",
        },
        notes: "Send Idempotency-Key to make retries return the original decision (header Idempotent-Replayed: true). 201 on a new decision, 200 on an idempotent replay, 409 PS_REPLAY_001 for a reused request_id or a key reused with a different body.",
      },
      { method: "POST", path: "/authorizations/evaluate", auth: "key", summary: "Dry run: the same evaluation against live state, reserving nothing and consuming no request_id.", body: { "…": "same fields as POST /operations" } },
      { method: "GET", path: "/operations/{id}", auth: "session or key", role: "viewer", summary: "One operation. An API key can read only its own agent's operations." },
      { method: "POST", path: "/operations/{id}/cancel", auth: "session or key", role: "operator", summary: "With an API key: withdraw a pending approval. In the console: release an unused, unexpired authorization's budget." },
    ],
  },
  {
    group: "Console: operations and approvals",
    items: [
      { method: "GET", path: "/operations", auth: "session", role: "viewer", summary: "List operations, newest first.", notes: "Query: decision, reason_code, agent_id, limit (≤200), before (created_at cursor from next_before)." },
      { method: "GET", path: "/approvals", auth: "session", role: "viewer", summary: "Operations waiting for a person (status=pending) or already decided (status=decided). Pending items include the EIP-712 typed data to sign." },
      { method: "POST", path: "/approvals/{id}/approve", auth: "session", role: "approver", summary: "Approve with an EIP-712 signature from your signed-in wallet over the exact operation.", body: { signature: "0x hex signature of typed_data" } },
      { method: "POST", path: "/approvals/{id}/reject", auth: "session", role: "approver", summary: "Reject a pending operation and release its reservation.", body: { reason: "optional string, ≤280 chars" } },
      { method: "GET", path: "/summary", auth: "session", role: "viewer", summary: "Counts for the last 24 hours (UTC, hourly buckets) and denials by reason." },
    ],
  },
  {
    group: "Console: agents and keys",
    items: [
      { method: "GET", path: "/agents", auth: "session", role: "viewer", summary: "List agents with policy, key count and last operation." },
      { method: "POST", path: "/agents", auth: "session", role: "admin", summary: "Register an agent.", body: { name: "string", chain_id: "46630", account: "smart account address", policy_id: "optional policy id; must protect the same account" } },
      { method: "GET", path: "/agents/{id}", auth: "session", role: "viewer", summary: "Agent detail with keys (never secrets) and last-hour usage." },
      { method: "PATCH", path: "/agents/{id}", auth: "session", role: "admin", summary: "Rename or rebind the policy.", body: { name: "optional", policy_id: "optional; null to unbind" } },
      { method: "POST", path: "/agents/{id}/pause", auth: "session", role: "operator", summary: "Deny the agent's new operations with PS_PAUSED_001.", body: { confirm: "true" } },
      { method: "POST", path: "/agents/{id}/resume", auth: "session", role: "admin", summary: "Resume a paused agent.", body: { confirm: "true" } },
      { method: "POST", path: "/agents/{id}/revoke", auth: "session", role: "admin", summary: "Permanently revoke the agent and all its keys.", body: { confirm: "true" } },
      { method: "POST", path: "/agents/{id}/credentials", auth: "session", role: "admin", summary: "Create an API key. The secret is in this response only.", body: { label: "optional string", scopes: "optional array: operations:write, operations:read, policy:read, audit:read, mcp (default all)" } },
      { method: "POST", path: "/credentials/{id}/revoke", auth: "session", role: "admin", summary: "Revoke an API key immediately." },
    ],
  },
  {
    group: "Console: policies",
    items: [
      { method: "GET", path: "/policies", auth: "session", role: "viewer", summary: "List policies with status and active version." },
      { method: "POST", path: "/policies", auth: "session", role: "admin", summary: "Create a draft from the strict starter, or from a full document.", body: { name: "string", policy_key: "a-z 0-9 _", chain_id: "46630", account: "address", document: "optional full policy instead" } },
      { method: "GET", path: "/policies/{id}", auth: "session", role: "viewer", summary: "Draft, its validation errors and hash, the active document and version history." },
      { method: "PUT", path: "/policies/{id}", auth: "session", role: "admin", summary: "Save the draft. Drafts may be invalid while you edit.", body: { document: "policy object" } },
      { method: "POST", path: "/policies/{id}/activate", auth: "session", role: "admin", summary: "Activate the saved draft as the next immutable version.", body: { confirm: "true", draft_hash: "draft_hash from GET, binding activation to what you reviewed" } },
      { method: "POST", path: "/policies/{id}/disable", auth: "session", role: "admin", summary: "Disable: bound agents are denied with PS_POLICY_001.", body: { confirm: "true" } },
    ],
  },
  {
    group: "Console: organization and audit",
    items: [
      { method: "GET", path: "/organization", auth: "session", role: "viewer", summary: "Name, emergency-stop state and counts." },
      { method: "PATCH", path: "/organization", auth: "session", role: "owner", summary: "Rename.", body: { name: "string" } },
      { method: "POST", path: "/organization/emergency-stop", auth: "session", role: "operator", summary: "Engage (operator) or lift (owner only) the organization's emergency stop.", body: { active: "boolean", confirm: "true" } },
      { method: "GET", path: "/members", auth: "session", role: "viewer", summary: "Members and roles." },
      { method: "POST", path: "/members", auth: "session", role: "owner", summary: "Add a wallet as a member or change its role.", body: { address: "address", role: "owner | admin | operator | approver | viewer" } },
      { method: "DELETE", path: "/members/{address}", auth: "session", role: "owner", summary: "Remove a member." },
      { method: "GET", path: "/audit-events", auth: "session", role: "viewer", summary: "Append-only audit events, newest first.", notes: "Query: type (exact or prefix, e.g. operation), agent_id, limit (≤200), before (seq cursor from next_before)." },
    ],
  },
  {
    group: "Integration self-service (API key)",
    items: [
      { method: "GET", path: "/integration", auth: "key", summary: "The agent this key belongs to: account, chain, scopes, bound policy, emergency stop. Any valid key." },
      { method: "GET", path: "/integration/policy", auth: "key", summary: "The exact active policy version and document the agent is evaluated against. Scope policy:read." },
      { method: "GET", path: "/integration/operations", auth: "key", summary: "The agent's own operations, newest first, without calldata. Scope operations:read.", notes: "?limit, ?before (ISO timestamp), ?decision" },
      { method: "GET", path: "/integration/audit-events", auth: "key", summary: "Audit events the agent caused. Scope audit:read.", notes: "?limit, ?before (sequence)" },
    ],
  },
  {
    group: "Integrations and webhooks (console)",
    items: [
      { method: "GET", path: "/usage", auth: "session", role: "viewer", summary: "Requests and outcomes per API key over 7 days, a daily series, agent tool calls and webhook deliveries." },
      { method: "GET", path: "/policies/{id}/compare", auth: "session", role: "viewer", summary: "Field-by-field changes between two versions, or a version and the draft.", notes: "?from=1&to=2, or ?from=1 for the draft" },
      { method: "GET", path: "/integrations", auth: "session", role: "viewer", summary: "Registered agents with keys (prefixes, scopes), activity, 24-hour requests and denials, webhook health." },
      { method: "POST", path: "/credentials/{id}/rotate", auth: "session", role: "admin", summary: "New secret with the same agent, label and scopes; the old key is revoked in the same statement. Secret shown once." },
      { method: "GET", path: "/webhooks", auth: "session", role: "viewer", summary: "Webhooks and the event types available." },
      { method: "POST", path: "/webhooks", auth: "session", role: "admin", summary: "Add a public HTTPS endpoint. The signing secret is shown once.", body: { url: "https URL", events: "array of event types", description: "optional text" } },
      { method: "PATCH", path: "/webhooks/{id}", auth: "session", role: "admin", summary: "Change events or enable/disable.", body: { events: "array (optional)", status: "active | disabled (optional)" } },
      { method: "DELETE", path: "/webhooks/{id}", auth: "session", role: "admin", summary: "Delete a webhook and its delivery history." },
      { method: "GET", path: "/webhooks/{id}/deliveries", auth: "session", role: "viewer", summary: "The last 50 deliveries with status, attempts and last error." },
      { method: "POST", path: "/webhooks/{id}/test", auth: "session", role: "admin", summary: "Send a signed ping now." },
      { method: "POST", path: "/webhook-deliveries/{id}/redeliver", auth: "session", role: "admin", summary: "Send a failed delivery again with the same event ID." },
      { method: "GET", path: "/security-events", auth: "session", role: "viewer", summary: "Security findings with evidence.", notes: "?status, ?category, ?refresh=1 runs detection now" },
      { method: "PATCH", path: "/security-events/{id}", auth: "session", role: "operator", summary: "Acknowledge, resolve or reopen a finding.", body: { status: "open | acknowledged | resolved" } },
    ],
  },
  {
    group: "PALISEC Agent (console)",
    items: [
      { method: "GET", path: "/agent/tools", auth: "session", role: "viewer", summary: "Every tool with risk, autonomy level, role and whether it is available to you; model status." },
      { method: "GET", path: "/agent/configuration", auth: "session", role: "viewer", summary: "Enabled, autonomy level (0-2) and disabled tools." },
      { method: "PATCH", path: "/agent/configuration", auth: "session", role: "admin", summary: "Change the agent's configuration (audited).", body: { enabled: "boolean", autonomy_level: "0 | 1 | 2", disabled_tools: "array of tool names" } },
      { method: "GET", path: "/agent/runs", auth: "session", role: "viewer", summary: "Recent runs in the organization." },
      { method: "POST", path: "/agent/runs", auth: "session", role: "viewer", summary: "Start a run with a message; advanced within this request's time budget.", body: { message: "text, at most 4000 characters" } },
      { method: "GET", path: "/agent/runs/{id}", auth: "session", role: "viewer", summary: "Messages, tool calls, action requests, evidence and unverified citations." },
      { method: "POST", path: "/agent/runs/{id}/messages", auth: "session", role: "viewer", summary: "Add a message to your own run.", body: { message: "text" } },
      { method: "POST", path: "/agent/runs/{id}/continue", auth: "session", role: "viewer", summary: "Advance your run while can_continue is true." },
      { method: "POST", path: "/agent/runs/{id}/cancel", auth: "session", role: "viewer", summary: "Cancel your run; pending action requests expire." },
      { method: "GET", path: "/agent/runs/{id}/events", auth: "session", role: "viewer", summary: "The trace behind a run's answers." },
      { method: "POST", path: "/agent/tools/{name}", auth: "session", role: "viewer", summary: "Run one tool directly, without a model. Same availability, role and audit rules.", body: { input: "the tool's input object" } },
      { method: "POST", path: "/agent/actions/{id}/confirm", auth: "session", role: "viewer", summary: "Confirm an action the agent prepared; runs once, under your role." },
      { method: "POST", path: "/agent/actions/{id}/reject", auth: "session", role: "viewer", summary: "Reject an action request." },
      { method: "GET", path: "/agent/activity", auth: "session", role: "viewer", summary: "Recent tool calls and action requests in the organization." },
    ],
  },
  {
    group: "Sign-in and health",
    items: [
      { method: "POST", path: "/auth/challenges", auth: "none", summary: "Create a SIWE (EIP-4361) challenge for a wallet address.", body: { address: "address", chain_id: "integer" } },
      { method: "POST", path: "/auth/verify", auth: "none", summary: "Verify the signed challenge and set the session cookie.", body: { nonce: "string", signature: "0x hex" } },
      { method: "POST", path: "/auth/logout", auth: "session", summary: "Revoke the session." },
      { method: "GET", path: "/me", auth: "session", summary: "Signed-in address and organizations." },
      { method: "GET", path: "/health", auth: "none", summary: "Component status. ?shallow=1 does not touch the database." },
    ],
  },
];

const METHOD_LC = (m: string) => m.toLowerCase();

/** OpenAPI 3.1 rendering of ENDPOINTS. Bodies are described field by field rather than fully typed. */
export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const g of ENDPOINTS) {
    for (const e of g.items) {
      const params = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
      const security = e.auth === "none" ? [] : e.auth === "key" ? [{ apiKey: [] }] : e.auth === "session" ? [{ session: [] }] : [{ session: [] }, { apiKey: [] }];
      paths[e.path] ??= {};
      paths[e.path]![METHOD_LC(e.method)] = {
        tags: [g.group],
        summary: e.summary,
        description: [e.role ? `Minimum role: ${e.role}.` : "", e.notes ?? ""].filter(Boolean).join(" ") || undefined,
        security,
        parameters: params.length ? params : undefined,
        requestBody: e.body
          ? {
              required: true,
              content: {
                "application/json": {
                  schema: { type: "object", properties: Object.fromEntries(Object.entries(e.body).map(([k, d]) => [k, { description: d }])) },
                },
              },
            }
          : undefined,
        responses: {
          "200": { description: "Success" },
          "4XX": { description: "Refused", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "503": { description: "PS_STATE_001: authoritative state unavailable; nothing was authorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      };
    }
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Palisec API",
      version: "0.4.0",
      description:
        "Pre-release, Robinhood Chain Testnet (46630) only. Decisions are recorded and enforced for agents that call the API; nothing is signed or broadcast by this release.",
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", description: "Agent API key: ps_test_ followed by 48 hex characters." },
        session: { type: "apiKey", in: "cookie", name: "__Host-ps_session", description: "Console session from wallet sign-in. State changes must send an Origin header for this site." },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["request_id", "error"],
          properties: {
            request_id: { type: "string" },
            error: {
              type: "object",
              required: ["code", "message", "retryable"],
              properties: { code: { type: "string", pattern: "^PS_[A-Z]+_\\d{3}$" }, message: { type: "string" }, retryable: { type: "boolean" } },
            },
          },
        },
        Decision: {
          type: "object",
          properties: {
            request_id: { type: "string" },
            operation_id: { type: ["string", "null"] },
            decision: { enum: ["ALLOW", "DENY", "REQUIRES_HUMAN_SIGNATURE"] },
            reason_code: { type: ["string", "null"] },
            policy_id: { type: ["string", "null"] },
            policy_version: { type: ["integer", "null"] },
            state: { enum: ["denied", "authorized", "pending_approval", "approved", "rejected", "cancelled", "expired", "authorization_expired", "not_recorded"] },
            authorization_id: { type: ["string", "null"] },
            expires_at: { type: ["string", "null"], format: "date-time" },
            transaction_hash: { type: "null", description: "Always null: this release never broadcasts." },
            retryable: { type: "boolean" },
            message: { type: "string" },
            checks: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
    paths,
  };
}

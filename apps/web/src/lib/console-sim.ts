import {
  EMPTY_STATE,
  EXAMPLE_ACCOUNT,
  EXAMPLE_ENV,
  EXAMPLE_POLICY,
  SCENARIOS,
  SIM_EPOCH,
  evaluate,
  fingerprint,
  validatePolicy,
  weiToUsdMicros,
  type CheckResult,
  type Decision,
  type Environment,
  type Intent,
  type LedgerState,
  type Policy,
  type ReasonCode,
  type ValidationError,
} from "@palisec/policy-schema";

/**
 * Console simulation workspace (spec §11, §7.4 "labeled demo dataset").
 *
 * Every decision comes from the canonical `evaluate()`; every policy check from
 * `validatePolicy()`. Nothing here signs, submits or talks to a network. Functions are
 * pure: (state, input, now) -> next state, so the seeded history below is real
 * evaluator output rather than hand-written rows.
 */

export const SIM_VERSION = 2;
export const APPROVAL_TTL_SECONDS = 300;
export const DENIAL_WINDOW_SECONDS = 3600;
export const LOCAL_ACTOR = "you · simulation owner";

export type AgentStatus = "active" | "paused" | "revoked";
export interface SimAgent {
  id: string;
  name: string;
  owner: string;
  status: AgentStatus;
  account: string;
  chain_id: number;
  created_at: number;
  rate_limit_per_min: number;
  budget_share_pct: number;
}

export type OpStatus = "denied" | "authorized" | "pending_approval" | "approved" | "rejected" | "expired" | "failed";
export interface SimOperation {
  id: string;
  seq: number;
  created_at: number;
  agent_id: string;
  scenario_id: string;
  label: string;
  idempotency_key: string;
  intent: Intent;
  decision: Decision;
  reason_code: ReasonCode | null;
  message: string;
  retryable: boolean;
  policy_id: string | null;
  policy_version: number | null;
  authorization_id: string | null;
  reservation_id: string | null;
  exposure_usd_micros: string;
  fee_estimate_wei: string | null;
  operation_hash: string;
  checks: CheckResult[];
  status: OpStatus;
  approval_expires_at: number | null;
  resolved_at: number | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export type AuditType =
  | "operation.evaluated"
  | "operation.idempotent_replay"
  | "approval.approved"
  | "approval.rejected"
  | "approval.expired"
  | "approval.invalidated"
  | "policy.draft_saved"
  | "policy.draft_discarded"
  | "policy.activated"
  | "agent.registered"
  | "agent.paused"
  | "agent.resumed"
  | "agent.revoked"
  | "credential.created"
  | "credential.revoked"
  | "breaker.engaged"
  | "breaker.released"
  | "breaker.threshold_set"
  | "org.renamed"
  | "org.member_added"
  | "org.role_changed";

export interface AuditEvent {
  id: string;
  seq: number;
  at: number;
  type: AuditType;
  actor: string;
  summary: string;
  request_id?: string;
  agent_id?: string;
  decision?: Decision;
  reason_code?: ReasonCode | null;
  policy_version?: number | null;
}

export interface SimCredential {
  id: string;
  label: string;
  hint: string;
  created_at: number;
  status: "active" | "revoked";
  revoked_at: number | null;
}

export interface PolicyVersion {
  version: number;
  activated_at: number;
  activated_by: string;
  note: string;
  policy: Policy;
}

export type Role = "Owner" | "Administrator" | "Operator" | "Approver" | "Viewer";
export const ROLES: { role: Role; permissions: string }[] = [
  { role: "Owner", permissions: "Organization settings, members, credentials, billing, and security configuration" },
  { role: "Administrator", permissions: "Agents, policies, approvals, and operational settings" },
  { role: "Operator", permissions: "Monitor agents, investigate events, and perform permitted operational actions" },
  { role: "Approver", permissions: "Review and sign assigned pending operations" },
  { role: "Viewer", permissions: "Read-only access to authorized operational data" },
];
export interface SimMember {
  id: string;
  name: string;
  identity: string;
  role: Role;
  added_at: number;
}

export interface SimState {
  sim_version: number;
  org: { id: string; name: string };
  seq: number;
  agents: SimAgent[];
  active_policy: Policy;
  versions: PolicyVersion[];
  draft: { policy: Policy; based_on: number; saved_at: number } | null;
  ledger: LedgerState;
  operations: SimOperation[];
  audit: AuditEvent[];
  credentials: SimCredential[];
  members: SimMember[];
  breakers: { global_stop: boolean; denial_threshold: number | null };
}

export type Result<T = SimState> = { ok: true; state: T } | { ok: false; error: string };

// ───────── helpers ─────────

const pad = (n: number, w = 4) => String(n).padStart(w, "0");

function audit(s: SimState, at: number, e: Omit<AuditEvent, "id" | "seq" | "at">): SimState {
  const seq = s.seq + 1;
  return { ...s, seq, audit: [...s.audit, { id: `evt_${pad(seq, 5)}`, seq, at, ...e }] };
}

export function buildEnv(s: SimState, now: number): Environment {
  return {
    ...EXAMPLE_ENV,
    now,
    eth_usd: { price_micros: EXAMPLE_ENV.eth_usd!.price_micros, observed_at: now },
    emergency_stop: s.breakers.global_stop,
    paused_agents: s.agents.filter((a) => a.status !== "active").map((a) => a.id),
  };
}

function setReservation(ledger: LedgerState, id: string | null, patch: Partial<LedgerState["reservations"][number]>): LedgerState {
  if (!id) return ledger;
  return { ...ledger, reservations: ledger.reservations.map((r) => (r.reservation_id === id ? { ...r, ...patch } : r)) };
}

function updateOp(s: SimState, id: string, patch: Partial<SimOperation>): SimState {
  return { ...s, operations: s.operations.map((o) => (o.id === id ? { ...o, ...patch } : o)) };
}

export const agentName = (s: SimState, id: string) => s.agents.find((a) => a.id === id)?.name ?? id;

/** Denials recorded in the trailing window, used by the denial-rate breaker. */
export function recentDenials(s: SimState, now: number): number {
  return s.operations.filter((o) => o.decision === "DENY" && o.created_at > now - DENIAL_WINDOW_SECONDS).length;
}

// ───────── operations ─────────

export interface SubmitInput {
  agent_id: string;
  scenario_id: string;
  idempotency_key: string;
}

/** POST /v1/operations, simulated. A repeated idempotency key returns the original result. */
export function submitOperation(s: SimState, input: SubmitInput, now: number): { state: SimState; op: SimOperation; replayed: boolean } {
  const existing = s.operations.find((o) => o.idempotency_key === input.idempotency_key);
  if (existing) {
    const state = audit(s, now, {
      type: "operation.idempotent_replay",
      actor: LOCAL_ACTOR,
      summary: `Idempotency key reused; returned ${existing.id} without re-evaluating.`,
      request_id: existing.id,
      agent_id: existing.agent_id,
    });
    return { state, op: existing, replayed: true };
  }
  const scenario = SCENARIOS.find((x) => x.id === input.scenario_id) ?? SCENARIOS[0]!;
  const seq = s.operations.length + 1;
  const intent: Intent = { ...scenario.intent, agent_id: input.agent_id, request_id: `rw_req_sim_${pad(seq)}`, deadline: now + 120 };
  const env = buildEnv(s, now);
  const r = evaluate(s.active_policy, intent, s.ledger, env);
  const reservation = r.next_state.reservations.find((x) => x.request_id === intent.request_id) ?? null;
  const pending = r.decision === "REQUIRES_HUMAN_SIGNATURE";
  const value = /^\d+$/.test(intent.value_wei) ? BigInt(intent.value_wei) : 0n;
  const op: SimOperation = {
    id: intent.request_id,
    seq,
    created_at: now,
    agent_id: input.agent_id,
    scenario_id: scenario.id,
    label: scenario.label,
    idempotency_key: input.idempotency_key,
    intent,
    decision: r.decision,
    reason_code: r.reason_code,
    message: r.message,
    retryable: r.retryable,
    policy_id: r.policy_id,
    policy_version: r.policy_version,
    authorization_id: r.authorization_id,
    reservation_id: reservation?.reservation_id ?? null,
    exposure_usd_micros: weiToUsdMicros(value, BigInt(env.eth_usd!.price_micros)).toString(),
    fee_estimate_wei: env.fee_estimate_wei,
    operation_hash: fingerprint(JSON.stringify(intent)),
    checks: r.checks,
    status: r.decision === "DENY" ? "denied" : pending ? "pending_approval" : "authorized",
    approval_expires_at: pending ? now + APPROVAL_TTL_SECONDS : null,
    resolved_at: null,
    resolved_by: null,
    resolution_note: null,
  };
  let state: SimState = { ...s, ledger: r.next_state, operations: [...s.operations, op] };
  state = audit(state, now, {
    type: "operation.evaluated",
    actor: agentName(s, input.agent_id),
    summary: `${scenario.label}: ${r.decision === "REQUIRES_HUMAN_SIGNATURE" ? "held for human approval" : r.decision.toLowerCase()}${r.reason_code ? ` · ${r.reason_code}` : ""}`,
    request_id: op.id,
    agent_id: op.agent_id,
    decision: r.decision,
    reason_code: r.reason_code,
    policy_version: r.policy_version,
  });
  // Denial-rate circuit breaker (spec §11.8).
  const t = state.breakers.denial_threshold;
  if (t !== null && r.decision === "DENY" && !state.breakers.global_stop && recentDenials(state, now) >= t) {
    state = { ...state, breakers: { ...state.breakers, global_stop: true } };
    state = audit(state, now, {
      type: "breaker.engaged",
      actor: "denial-rate breaker",
      summary: `${t} denials within ${DENIAL_WINDOW_SECONDS / 60} minutes: new authorizations disabled globally.`,
    });
  }
  return { state, op, replayed: false };
}

/** Why an approval cannot proceed right now, or null when it can (spec §11.5). */
export function approvalBlocker(s: SimState, op: SimOperation, now: number): string | null {
  if (op.status !== "pending_approval") return "This operation is not pending.";
  if (op.approval_expires_at !== null && now >= op.approval_expires_at) return "The approval window has expired.";
  const agent = s.agents.find((a) => a.id === op.agent_id);
  if (!agent || agent.status !== "active") return "The agent is paused or revoked.";
  if (op.policy_version !== s.active_policy.version) return "The policy version changed after this request was evaluated.";
  if (s.breakers.global_stop) return "New authorizations are disabled by the global stop.";
  return null;
}

export function approveOperation(s: SimState, id: string, now: number, actor = LOCAL_ACTOR): Result {
  const op = s.operations.find((o) => o.id === id);
  if (!op) return { ok: false, error: "Unknown operation." };
  const blocked = approvalBlocker(s, op, now);
  if (blocked) return { ok: false, error: blocked };
  let state = updateOp(s, id, { status: "approved", resolved_at: now, resolved_by: actor, resolution_note: "Approved in simulation. No wallet signature was produced and nothing was submitted." });
  state = { ...state, ledger: setReservation(state.ledger, op.reservation_id, { state: "reserved", expires_at: now + APPROVAL_TTL_SECONDS }) };
  return {
    ok: true,
    state: audit(state, now, { type: "approval.approved", actor, summary: `Approved ${op.label} (unsigned, simulation).`, request_id: id, agent_id: op.agent_id, policy_version: op.policy_version }),
  };
}

export function rejectOperation(s: SimState, id: string, now: number, actor = LOCAL_ACTOR): Result {
  const op = s.operations.find((o) => o.id === id);
  if (!op) return { ok: false, error: "Unknown operation." };
  if (op.status !== "pending_approval") return { ok: false, error: "This operation is not pending." };
  let state = updateOp(s, id, { status: "rejected", resolved_at: now, resolved_by: actor, resolution_note: "Rejected. The reservation was released and nothing was signed." });
  state = { ...state, ledger: setReservation(state.ledger, op.reservation_id, { state: "released" }) };
  return { ok: true, state: audit(state, now, { type: "approval.rejected", actor, summary: `Rejected ${op.label}.`, request_id: id, agent_id: op.agent_id, policy_version: op.policy_version }) };
}

/** Expire approvals and reservations whose windows have closed. Returns the same object when nothing changed. */
export function sweep(s: SimState, now: number): SimState {
  let state = s;
  for (const op of s.operations) {
    if (op.status === "pending_approval" && op.approval_expires_at !== null && op.approval_expires_at <= now) {
      state = updateOp(state, op.id, { status: "expired", resolved_at: op.approval_expires_at, resolved_by: "approval timer", resolution_note: "Approval window closed. The pending authorization was invalidated." });
      state = { ...state, ledger: setReservation(state.ledger, op.reservation_id, { state: "released" }) };
      state = audit(state, op.approval_expires_at, { type: "approval.expired", actor: "approval timer", summary: `Approval for ${op.label} expired.`, request_id: op.id, agent_id: op.agent_id, policy_version: op.policy_version });
    }
  }
  const stale = state.ledger.reservations.some((r) => r.state === "reserved" && r.expires_at <= now);
  if (stale) {
    state = { ...state, ledger: { ...state.ledger, reservations: state.ledger.reservations.map((r) => (r.state === "reserved" && r.expires_at <= now ? { ...r, state: "released" as const } : r)) } };
  }
  return state;
}

// ───────── policies ─────────

export function saveDraft(s: SimState, policy: Policy, now: number): SimState {
  const first = s.draft === null;
  const state = { ...s, draft: { policy: { ...policy, status: "draft" as const }, based_on: s.active_policy.version, saved_at: now } };
  return first ? audit(state, now, { type: "policy.draft_saved", actor: LOCAL_ACTOR, summary: `Draft created from version ${s.active_policy.version}.`, policy_version: s.active_policy.version }) : state;
}

export function discardDraft(s: SimState, now: number): SimState {
  if (!s.draft) return s;
  return audit({ ...s, draft: null }, now, { type: "policy.draft_discarded", actor: LOCAL_ACTOR, summary: "Draft discarded without activation." });
}

/** POST /v1/policies/{id}/activate, simulated. Only a schema-valid draft activates. */
export function activateDraft(s: SimState, now: number, note: string, actor = LOCAL_ACTOR): Result | { ok: false; error: string; errors: ValidationError[] } {
  if (!s.draft) return { ok: false, error: "There is no draft to activate." };
  const version = Math.max(s.active_policy.version, ...s.versions.map((v) => v.version)) + 1;
  const policy: Policy = { ...s.draft.policy, version, status: "active" };
  const errors = validatePolicy(policy);
  if (errors.length) return { ok: false, error: "The draft does not pass schema validation.", errors };
  let state: SimState = { ...s, active_policy: policy, draft: null, versions: [...s.versions, { version, activated_at: now, activated_by: actor, note: note || "No note", policy }] };
  state = audit(state, now, { type: "policy.activated", actor, summary: `Policy ${policy.policy_id} version ${version} activated.`, policy_version: version });
  // Policy changes invalidate approvals bound to the old version (spec §5.3).
  for (const op of state.operations.filter((o) => o.status === "pending_approval")) {
    state = updateOp(state, op.id, { status: "failed", resolved_at: now, resolved_by: "policy activation", resolution_note: `Invalidated: evaluated under version ${op.policy_version}, now version ${version}.` });
    state = { ...state, ledger: setReservation(state.ledger, op.reservation_id, { state: "released" }) };
    state = audit(state, now, { type: "approval.invalidated", actor: "policy activation", summary: `Pending approval for ${op.label} invalidated by version ${version}.`, request_id: op.id, agent_id: op.agent_id, policy_version: op.policy_version });
  }
  return { ok: true, state };
}

// ───────── agents ─────────

export function setAgentStatus(s: SimState, id: string, status: AgentStatus, now: number, actor = LOCAL_ACTOR): Result {
  const agent = s.agents.find((a) => a.id === id);
  if (!agent) return { ok: false, error: "Unknown agent." };
  if (agent.status === "revoked") return { ok: false, error: "A revoked agent cannot change state. Register a new agent." };
  if (agent.status === status) return { ok: false, error: `Agent is already ${status}.` };
  const state = { ...s, agents: s.agents.map((a) => (a.id === id ? { ...a, status } : a)) };
  const type = status === "paused" ? "agent.paused" : status === "active" ? "agent.resumed" : "agent.revoked";
  return { ok: true, state: audit(state, now, { type, actor, summary: `${agent.name} ${status === "active" ? "resumed" : status}. Confirmed by the local evaluator.`, agent_id: id }) };
}

export function registerAgent(s: SimState, name: string, now: number, actor = LOCAL_ACTOR): Result {
  const clean = name.trim();
  if (clean.length < 3 || clean.length > 48) return { ok: false, error: "Name must be 3 to 48 characters." };
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "agent";
  const id = `agent_${slug}_${pad(s.agents.length + 1, 2)}`;
  if (s.agents.some((a) => a.id === id)) return { ok: false, error: "An agent with that identifier already exists." };
  const agent: SimAgent = { id, name: clean, owner: actor, status: "active", account: EXAMPLE_ACCOUNT, chain_id: 4663, created_at: now, rate_limit_per_min: 30, budget_share_pct: 0 };
  return { ok: true, state: audit({ ...s, agents: [...s.agents, agent] }, now, { type: "agent.registered", actor, summary: `Registered ${clean} (${id}).`, agent_id: id }) };
}

// ───────── credentials & breakers ─────────

/** Returns the full secret once; only a hint is stored. The secret is not valid anywhere. */
export function createCredential(s: SimState, label: string, now: number, entropy: string): { state: SimState; secret: string } {
  const id = `cred_${pad(s.credentials.length + 1, 3)}`;
  const secret = `rw_sim_${entropy}`;
  const cred: SimCredential = { id, label: label.trim() || "Unnamed credential", hint: `rw_sim_…${secret.slice(-4)}`, created_at: now, status: "active", revoked_at: null };
  const state = audit({ ...s, credentials: [...s.credentials, cred] }, now, { type: "credential.created", actor: LOCAL_ACTOR, summary: `Credential ${cred.label} (${cred.hint}) created.` });
  return { state, secret };
}

export function revokeCredential(s: SimState, id: string, now: number): Result {
  const c = s.credentials.find((x) => x.id === id);
  if (!c || c.status === "revoked") return { ok: false, error: "Credential is not active." };
  const state = { ...s, credentials: s.credentials.map((x) => (x.id === id ? { ...x, status: "revoked" as const, revoked_at: now } : x)) };
  return { ok: true, state: audit(state, now, { type: "credential.revoked", actor: LOCAL_ACTOR, summary: `Credential ${c.label} (${c.hint}) revoked.` }) };
}

export function setGlobalStop(s: SimState, on: boolean, now: number, actor = LOCAL_ACTOR): SimState {
  if (s.breakers.global_stop === on) return s;
  return audit({ ...s, breakers: { ...s.breakers, global_stop: on } }, now, {
    type: on ? "breaker.engaged" : "breaker.released",
    actor,
    summary: on ? "New authorizations disabled globally." : "Global stop released after health checks.",
  });
}

export function setDenialThreshold(s: SimState, threshold: number | null, now: number): SimState {
  return audit({ ...s, breakers: { ...s.breakers, denial_threshold: threshold } }, now, {
    type: "breaker.threshold_set",
    actor: LOCAL_ACTOR,
    summary: threshold === null ? "Denial-rate breaker disabled." : `Denial-rate breaker set to ${threshold} denials per hour.`,
  });
}

// ───────── organization ─────────

export function renameOrg(s: SimState, name: string, now: number): Result {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 64) return { ok: false, error: "Name must be 2 to 64 characters." };
  return { ok: true, state: audit({ ...s, org: { ...s.org, name: clean } }, now, { type: "org.renamed", actor: LOCAL_ACTOR, summary: `Organization renamed to ${clean}.` }) };
}

export function addMember(s: SimState, name: string, identity: string, role: Role, now: number): Result {
  if (name.trim().length < 2) return { ok: false, error: "Enter the member's name." };
  if (!/^0x[0-9a-fA-F]{40}$/.test(identity.trim()) && !/^[^\s@]+@[^\s@]+$/.test(identity.trim())) return { ok: false, error: "Identity must be a wallet address or an email." };
  if (role === "Owner") return { ok: false, error: "Ownership is transferred, not granted on invite." };
  const m: SimMember = { id: `mem_${pad(s.members.length + 1, 3)}`, name: name.trim(), identity: identity.trim(), role, added_at: now };
  return { ok: true, state: audit({ ...s, members: [...s.members, m] }, now, { type: "org.member_added", actor: LOCAL_ACTOR, summary: `${m.name} added as ${role}.` }) };
}

export function changeRole(s: SimState, id: string, role: Role, now: number): Result {
  const m = s.members.find((x) => x.id === id);
  if (!m) return { ok: false, error: "Unknown member." };
  if (m.role === "Owner") return { ok: false, error: "Transfer ownership before changing the owner's role." };
  if (role === "Owner") return { ok: false, error: "Ownership transfer needs the owner's independent confirmation, which requires the deployed control plane." };
  const state = { ...s, members: s.members.map((x) => (x.id === id ? { ...x, role } : x)) };
  return { ok: true, state: audit(state, now, { type: "org.role_changed", actor: LOCAL_ACTOR, summary: `${m.name}: ${m.role} → ${role}.` }) };
}

// ───────── seed ─────────

/** Seeded history ends here; the live simulated clock continues from this instant. */
export const SEED_END = SIM_EPOCH + 20 * 3600;

function blank(): SimState {
  return {
    sim_version: SIM_VERSION,
    org: { id: "org_sim_0001", name: "Example Organization" },
    seq: 0,
    agents: [
      { id: "agent_rebalancer_01", name: "Portfolio rebalancer", owner: "ops@example.org", status: "active", account: EXAMPLE_ACCOUNT, chain_id: 4663, created_at: SIM_EPOCH, rate_limit_per_min: 30, budget_share_pct: 60 },
      { id: "agent_payouts_02", name: "Vendor payouts", owner: "finance@example.org", status: "active", account: EXAMPLE_ACCOUNT, chain_id: 4663, created_at: SIM_EPOCH, rate_limit_per_min: 10, budget_share_pct: 30 },
      { id: "agent_research_03", name: "Research sandbox", owner: "lab@example.org", status: "active", account: EXAMPLE_ACCOUNT, chain_id: 4663, created_at: SIM_EPOCH, rate_limit_per_min: 5, budget_share_pct: 10 },
    ],
    active_policy: EXAMPLE_POLICY,
    versions: [{ version: EXAMPLE_POLICY.version, activated_at: SIM_EPOCH, activated_by: "ops@example.org", note: "Initial trading policy", policy: EXAMPLE_POLICY }],
    draft: null,
    ledger: EMPTY_STATE,
    operations: [],
    audit: [],
    credentials: [],
    members: [
      { id: "mem_001", name: "You", identity: "local browser session", role: "Owner", added_at: SIM_EPOCH },
      { id: "mem_002", name: "Ops lead", identity: "ops@example.org", role: "Administrator", added_at: SIM_EPOCH },
      { id: "mem_003", name: "Treasury approver", identity: "0x7777777777777777777777777777777777777777", role: "Approver", added_at: SIM_EPOCH },
    ],
    breakers: { global_stop: false, denial_threshold: null },
  };
}

type SeedStep =
  | { t: number; op: string; agent: string }
  | { t: number; approve: number }
  | { t: number; reject: number }
  | { t: number; pause: string }
  | { t: number; credential: string };

// Hours and seconds after SIM_EPOCH. Ops are referenced by their 1-based sequence number.
const SEED: SeedStep[] = [
  { t: 60, credential: "Rebalancer production key" },
  { t: 1 * 3600, op: "token-transfer", agent: "agent_payouts_02" },
  { t: 2 * 3600, op: "swap", agent: "agent_rebalancer_01" },
  { t: 2 * 3600 + 20, op: "swap", agent: "agent_rebalancer_01" },
  { t: 4 * 3600, op: "unknown-target", agent: "agent_research_03" },
  { t: 5 * 3600, op: "large-swap", agent: "agent_rebalancer_01" },
  { t: 5 * 3600 + 140, approve: 5 },
  { t: 7 * 3600, op: "over-limit", agent: "agent_rebalancer_01" },
  { t: 9 * 3600, op: "unknown-method", agent: "agent_payouts_02" },
  { t: 9 * 3600 + 90, reject: 7 },
  { t: 11 * 3600, op: "denied-target", agent: "agent_research_03" },
  { t: 11 * 3600 + 30, pause: "agent_research_03" },
  { t: 12 * 3600, op: "swap", agent: "agent_research_03" },
  { t: 14 * 3600, op: "token-transfer", agent: "agent_payouts_02" },
  { t: 16 * 3600, op: "large-swap", agent: "agent_rebalancer_01" },
  { t: 18 * 3600, op: "swap", agent: "agent_rebalancer_01" },
  { t: 19 * 3600, op: "token-transfer", agent: "agent_payouts_02" },
  { t: 20 * 3600 - 30, op: "large-swap", agent: "agent_rebalancer_01" },
  { t: 20 * 3600 - 10, op: "unknown-method", agent: "agent_payouts_02" },
];

export function seedState(): SimState {
  let s = blank();
  for (const step of SEED) {
    const now = SIM_EPOCH + step.t;
    s = sweep(s, now);
    if ("op" in step) s = submitOperation(s, { agent_id: step.agent, scenario_id: step.op, idempotency_key: `seed-${s.operations.length + 1}` }, now).state;
    else if ("approve" in step) { const r = approveOperation(s, `rw_req_sim_${pad(step.approve)}`, now, "Treasury approver"); if (r.ok) s = r.state; }
    else if ("reject" in step) { const r = rejectOperation(s, `rw_req_sim_${pad(step.reject)}`, now, "Treasury approver"); if (r.ok) s = r.state; }
    else if ("pause" in step) { const r = setAgentStatus(s, step.pause, "paused", now, "Ops lead"); if (r.ok) s = r.state; }
    else if ("credential" in step) s = createCredential(s, step.credential, now, "seeded000000000000000000a1b2").state;
  }
  return sweep(s, SEED_END);
}

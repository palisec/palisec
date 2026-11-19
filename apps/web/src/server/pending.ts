import "server-only";
import { classifyPolicyChange, summarizeChanges, type Policy, type PolicyChange } from "@palisec/policy-schema";
import type { MemberContext } from "./access";
import { db, type Row } from "./db";
import { afterChange } from "./events";
import { BadRequest, HttpError, logEvent } from "./http";

/*
 * Phase 6, loosening delay. Changes that weaken an organization's rules wait in pending_changes; the
 * current state keeps deciding until effective_at. Due changes are applied lazily by ps_apply_due():
 * on every agent request that finds one due, on console requests, and on the health check that the
 * uptime monitor calls, so nothing depends on a paid scheduler.
 */

export const DELAY_MAX_SECONDS = 72 * 3600;
const DELAY_MIN_SECONDS = 15 * 60;

/**
 * The lowest delay an organization may set. Test servers may lower it (never in production), so the
 * suites can watch a change apply without waiting 15 minutes.
 */
export function delayMinSeconds(): number {
  const floor = Number(process.env.PALISEC_TEST_MIN_DELAY_SECONDS);
  if (process.env.VERCEL_ENV !== "production" && Number.isInteger(floor) && floor >= 1 && floor < DELAY_MIN_SECONDS) return floor;
  return DELAY_MIN_SECONDS;
}

/** Delays a new organization starts with: 60 minutes and 15 minutes, or a test server's override. */
export function initialDelays(): { loosening: number; lift: number } {
  const t = Number(process.env.PALISEC_TEST_DEFAULT_DELAY_SECONDS);
  if (process.env.VERCEL_ENV !== "production" && Number.isInteger(t) && t >= 1 && t < 900) return { loosening: t, lift: t };
  return { loosening: 3600, lift: 900 };
}

export type PendingKind = "policy_activation" | "agent_rebind" | "agent_resume" | "emergency_lift" | "delay_change";

/** Applies whatever is due for one organization (or all) and announces each application. */
export async function applyDue(orgId: string | null): Promise<Row[]> {
  try {
    const [{ applied }] = await db()`SELECT ps_apply_due(${orgId}::uuid) AS applied`;
    const list = (applied ?? []) as Row[];
    for (const a of list)
      afterChange(a.org_id, "policy.loosening_applied", {
        pending_change_id: a.id,
        kind: a.kind,
        policy_id: a.policy_id,
        policy_version: a.policy_version,
        agent_id: a.agent_id,
        setting: a.setting,
        summary: a.summary,
        diff: a.diff,
        effective_at: a.effective_at,
      });
    // The events these changes sent before Phase 6, now sent when they take effect.
    for (const a of list) {
      if (a.kind === "emergency_lift") afterChange(a.org_id, "organization.emergency_stop", { active: false });
      if (a.kind === "agent_resume") afterChange(a.org_id, "agent.status_changed", { agent_id: a.agent_id, status: "active" });
    }
    return list;
  } catch (e) {
    // A failure here leaves the change pending (the old, stricter state keeps deciding): fail closed.
    logEvent("error", "pending.apply_failed", { message: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/** Webhook, security finding and (through the console banner) a visible countdown for a new pending change. */
export function announcePending(orgId: string, data: Record<string, unknown>) {
  afterChange(orgId, "policy.loosening_pending", data, true);
}

const PUBLIC_FIELDS = (r: Row) => ({
  id: r.id,
  kind: r.kind as PendingKind,
  state: r.state,
  policy_id: r.policy_id ?? null,
  policy_key: r.policy_key ?? null,
  policy_version: r.policy_version ?? null,
  agent_id: r.agent_id ?? null,
  agent_name: r.agent_name ?? null,
  setting: r.setting ?? null,
  summary: r.summary,
  diff: r.diff as PolicyChange[],
  requested_by: r.requested_by_address ?? null,
  requested_at: new Date(r.requested_at).toISOString(),
  effective_at: new Date(r.effective_at).toISOString(),
  resolved_at: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
  resolution: r.resolution ?? null,
});
export type PendingChange = ReturnType<typeof PUBLIC_FIELDS>;

/** Open changes for an organization (optionally one policy), soonest first. */
export async function listPending(orgId: string, filter: { policyId?: string } = {}): Promise<PendingChange[]> {
  const rows = await db()`
    SELECT pc.*, p.policy_key, a.name AS agent_name, u.address AS requested_by_address
    FROM pending_changes pc LEFT JOIN policies p ON p.id = pc.policy_id LEFT JOIN agents a ON a.id = pc.agent_id
    LEFT JOIN users u ON u.id = pc.requested_by
    WHERE pc.org_id = ${orgId}::uuid AND pc.state = 'pending' AND (${filter.policyId ?? null}::uuid IS NULL OR pc.policy_id = ${filter.policyId ?? null}::uuid)
    ORDER BY pc.effective_at`;
  return rows.map(PUBLIC_FIELDS);
}

/** Cancels an open change at once (owner, admin or operator). Audited; announced to webhooks. */
export async function cancelPending(ctx: MemberContext, id: string, reason = "cancelled"): Promise<PendingChange> {
  const [{ r }] = await db()`SELECT ps_cancel_pending(${id}::uuid, ${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, ${reason}) AS r`;
  if (!r) throw new HttpError(404, "PS_REQUEST_001", "No open pending change with this ID in this organization");
  afterChange(ctx.orgId, "policy.loosening_cancelled", {
    pending_change_id: r.id,
    kind: r.kind,
    policy_id: r.policy_id,
    policy_version: r.policy_version,
    agent_id: r.agent_id,
    summary: r.summary,
    diff: r.diff,
    reason,
  });
  return PUBLIC_FIELDS({ ...r, state: "cancelled" });
}

export async function orgDelays(orgId: string): Promise<{ loosening: number; lift: number }> {
  const [o] = await db()`SELECT loosening_delay_seconds, stop_lift_delay_seconds FROM organizations WHERE id = ${orgId}::uuid`;
  if (!o) throw new HttpError(404, "PS_REQUEST_001", "Organization not found");
  return { loosening: Number(o.loosening_delay_seconds), lift: Number(o.stop_lift_delay_seconds) };
}

/** Records a non-policy loosening (agent rebind or resume, stop lift, shorter delays) and announces it. */
export async function requestPending(
  ctx: MemberContext,
  kind: Exclude<PendingKind, "policy_activation">,
  input: { agentId?: string; setting?: Record<string, unknown>; diff: PolicyChange[]; delaySeconds: number },
): Promise<{ outcome: "pending" | "already_pending"; pending_change_id: string; effective_at: string }> {
  const summary = summarizeChanges(input.diff);
  const [{ r }] = await db()`
    SELECT ps_request_pending(${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, ${kind}, ${input.agentId ?? null}::uuid,
      ${input.setting ? JSON.stringify(input.setting) : null}::text::jsonb, ${JSON.stringify(input.diff)}::text::jsonb, ${summary}, ${input.delaySeconds}::int) AS r`;
  if (r.outcome === "conflict") throw new HttpError(409, "PS_REQUEST_001", "Another change to this agent is already pending. Cancel it first.");
  if (r.outcome === "pending")
    announcePending(ctx.orgId, {
      pending_change_id: r.pending_change_id,
      kind,
      agent_id: input.agentId ?? null,
      setting: input.setting ?? null,
      summary,
      diff: input.diff,
      effective_at: r.effective_at,
    });
  return { outcome: r.outcome, pending_change_id: r.pending_change_id, effective_at: new Date(r.effective_at).toISOString() };
}

/** The document that decides for a policy today, or null (no version, or disabled: everything is denied). */
export async function decidingDocument(orgId: string, policyId: string | null): Promise<Policy | null> {
  if (!policyId) return null;
  const [r] = await db()`
    SELECT pv.document FROM policies p JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE p.id = ${policyId}::uuid AND p.org_id = ${orgId}::uuid AND p.disabled_at IS NULL`;
  return (r?.document as Policy | undefined) ?? null;
}

/**
 * Moving an agent to another policy (or onto one) is classified like an activation: the agent's rules
 * today against the rules it would get. Loosening waits; tightening applies now.
 */
export async function classifyRebind(orgId: string, fromPolicy: string | null, toPolicy: string | null) {
  const before = await decidingDocument(orgId, fromPolicy);
  const after = await decidingDocument(orgId, toPolicy);
  if (!after) return { loosening: false, changes: [{ path: "$", kind: "tightening" as const, from: fromPolicy, to: toPolicy, note: "agent moved to no active policy (everything is denied)" }] };
  const c = classifyPolicyChange(before, after);
  return { loosening: c.loosening, changes: [{ path: "$.policy_id", kind: c.loosening ? ("loosening" as const) : ("tightening" as const), from: fromPolicy, to: toPolicy, note: "agent moved to another policy" }, ...c.changes] };
}

/** Delay settings: raising applies now; lowering is itself a loosening, delayed by the current delay. */
export function parseDelaySetting(body: Record<string, unknown>, current: { loosening: number; lift: number }) {
  const min = delayMinSeconds();
  const read = (k: string, cur: number) => {
    const v = body[k];
    if (v === undefined) return cur;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > DELAY_MAX_SECONDS)
      throw new BadRequest(`${k} must be an integer between ${min} and ${DELAY_MAX_SECONDS} seconds`);
    return v;
  };
  const loosening = read("loosening_delay_seconds", current.loosening);
  const lift = read("stop_lift_delay_seconds", current.lift);
  const diff: PolicyChange[] = [];
  if (loosening !== current.loosening)
    diff.push({ path: "$.loosening_delay_seconds", kind: loosening < current.loosening ? "loosening" : "tightening", from: current.loosening, to: loosening, note: `loosening delay ${loosening < current.loosening ? "shortened" : "lengthened"} to ${loosening}s` });
  if (lift !== current.lift)
    diff.push({ path: "$.stop_lift_delay_seconds", kind: lift < current.lift ? "loosening" : "tightening", from: current.lift, to: lift, note: `emergency-stop lift delay ${lift < current.lift ? "shortened" : "lengthened"} to ${lift}s` });
  return { loosening, lift, diff };
}

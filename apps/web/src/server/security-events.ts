import "server-only";
import type { MemberContext } from "./access";
import { db, type Row } from "./db";
import { BadRequest, HttpError } from "./http";
import { emit } from "./webhooks";

/*
 * Security events (spec 2.0 §34). Deterministic detectors over the authoritative records produce
 * findings with evidence (record IDs and the numbers that triggered them). One open finding per
 * condition: a repeat updates its count instead of creating a duplicate. Detection runs on demand
 * (console, agent, after an operation) because there is no always-on worker on the free plan.
 *
 * Categories the deployment cannot observe yet (signing_failure, attestation_mismatch: no signer;
 * invalid_signature, integration_credential_failure: refused before an identity is known) are
 * never produced, rather than guessed.
 */

export const CATEGORIES = [
  "unusual_proposal", "repeated_denial", "spending_threshold", "unfamiliar_recipient", "unapproved_contract",
  "unexpected_selector", "failed_approval", "replay_attempt", "invalid_signature", "signing_failure",
  "attestation_mismatch", "integration_credential_failure", "emergency_stop", "account_pause",
] as const;
export type Category = (typeof CATEGORIES)[number];
type Severity = "info" | "warning" | "critical";

interface Candidate {
  category: Category;
  severity: Severity;
  title: string;
  fingerprint: string;
  evidence: Record<string, unknown>;
}

const lastRun = new Map<string, number>();
const MIN_INTERVAL_MS = 30_000;

/** Runs every detector for the organization over the last 24 hours. */
async function candidates(orgId: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const day = new Date().toISOString().slice(0, 10);

  const denials = await db()`
    SELECT o.agent_id, a.name, o.reason_code, o.target, o.selector, count(*)::int AS n,
      max(o.created_at) AS last_at, (array_agg(o.id ORDER BY o.created_at DESC))[1:5] AS ids
    FROM operations o JOIN agents a ON a.id = o.agent_id
    WHERE o.org_id = ${orgId}::uuid AND o.decision = 'DENY' AND o.created_at > now() - interval '24 hours'
    GROUP BY o.agent_id, a.name, o.reason_code, o.target, o.selector`;
  const perAgent = new Map<string, { name: string; n: number; ids: string[] }>();
  for (const d of denials) {
    const agg = perAgent.get(d.agent_id) ?? { name: d.name as string, n: 0, ids: [] as string[] };
    agg.n += d.n;
    agg.ids.push(...(d.ids as string[]));
    perAgent.set(d.agent_id, agg);
    const ev = { agent_id: d.agent_id, agent_name: d.name, reason_code: d.reason_code, target: d.target, count_24h: d.n, operation_ids: d.ids, last_at: d.last_at };
    if (d.reason_code === "PS_REPLAY_001")
      out.push({ category: "replay_attempt", severity: "warning", title: `${d.name}: ${d.n} replayed or expired request(s) refused`, fingerprint: `replay:${d.agent_id}:${day}`, evidence: ev });
    if (d.reason_code === "PS_TARGET_001" || d.reason_code === "PS_POLICY_002")
      out.push({ category: "unapproved_contract", severity: d.reason_code === "PS_POLICY_002" ? "warning" : "info", title: `${d.name} tried ${d.reason_code === "PS_POLICY_002" ? "a denylisted" : "an unapproved"} target ${String(d.target).slice(0, 10)}…`, fingerprint: `target:${d.agent_id}:${String(d.target).toLowerCase()}:${day}`, evidence: ev });
    if (d.reason_code === "PS_METHOD_001")
      out.push({ category: "unexpected_selector", severity: "info", title: `${d.name} called selector ${d.selector ?? "?"} that is not allowed`, fingerprint: `selector:${d.agent_id}:${d.selector}:${day}`, evidence: ev });
  }
  for (const [agentId, agg] of perAgent) {
    if (agg.n >= 5)
      out.push({
        category: "repeated_denial",
        severity: agg.n >= 20 ? "critical" : "warning",
        title: `${agg.name}: ${agg.n} denied operations in 24 hours`,
        fingerprint: `denials:${agentId}:${day}`,
        evidence: { agent_id: agentId, agent_name: agg.name, count_24h: agg.n, operation_ids: agg.ids.slice(0, 10) },
      });
  }

  const budget = await db()`
    SELECT o.policy_id, p.policy_key, (pv.document->'limits'->>'hourly_budget_usd_micros')::numeric AS cap,
      sum(o.usd_micros) FILTER (WHERE ps_holds_budget(o.state, o.expires_at) AND o.created_at > now() - interval '1 hour') AS used
    FROM operations o JOIN policies p ON p.id = o.policy_id JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE o.org_id = ${orgId}::uuid AND o.created_at > now() - interval '1 hour'
    GROUP BY o.policy_id, p.policy_key, cap`;
  for (const b of budget) {
    const cap = Number(b.cap);
    const used = Number(b.used ?? 0);
    if (cap > 0 && used / cap >= 0.8)
      out.push({
        category: "spending_threshold",
        severity: used >= cap ? "critical" : "warning",
        title: `${b.policy_key}: ${Math.round((used / cap) * 100)}% of the hourly budget in use`,
        fingerprint: `budget:${b.policy_id}:${new Date().toISOString().slice(0, 13)}`,
        evidence: { policy_id: b.policy_id, policy_key: b.policy_key, used_usd_micros: String(b.used ?? 0), hourly_budget_usd_micros: String(b.cap) },
      });
  }

  const recipients = await db()`
    SELECT o.agent_id, a.name, o.target, min(o.created_at) AS first_at, (array_agg(o.id))[1] AS id
    FROM operations o JOIN agents a ON a.id = o.agent_id
    WHERE o.org_id = ${orgId}::uuid AND o.decision <> 'DENY' AND o.created_at > now() - interval '24 hours'
      AND NOT EXISTS (SELECT 1 FROM operations p WHERE p.agent_id = o.agent_id AND p.target = o.target AND p.decision <> 'DENY'
        AND p.created_at <= now() - interval '24 hours' AND p.created_at > now() - interval '30 days')
      AND EXISTS (SELECT 1 FROM operations h WHERE h.agent_id = o.agent_id AND h.created_at <= now() - interval '24 hours')
    GROUP BY o.agent_id, a.name, o.target`;
  for (const r of recipients)
    out.push({ category: "unfamiliar_recipient", severity: "info", title: `${r.name} sent to a target it has not used in 30 days`, fingerprint: `recipient:${r.agent_id}:${String(r.target).toLowerCase()}`, evidence: { agent_id: r.agent_id, agent_name: r.name, target: r.target, first_at: r.first_at, operation_ids: [r.id] } });

  const rejected = await db()`
    SELECT count(*)::int AS n, (array_agg(id ORDER BY created_at DESC))[1:5] AS ids FROM operations
    WHERE org_id = ${orgId}::uuid AND state = 'rejected' AND decided_at > now() - interval '24 hours'`;
  if (rejected[0] && rejected[0].n > 0)
    out.push({ category: "failed_approval", severity: "info", title: `${rejected[0].n} operation(s) rejected by approvers in 24 hours`, fingerprint: `rejected:${day}`, evidence: { count_24h: rejected[0].n, operation_ids: rejected[0].ids } });

  const audits = await db()`
    SELECT e.event_id, e.type, e.created_at, e.actor_agent_id, a.name FROM audit_events e LEFT JOIN agents a ON a.id = e.actor_agent_id
    WHERE e.org_id = ${orgId}::uuid AND e.type IN ('org.emergency_stop.activated', 'agent.paused') AND e.created_at > now() - interval '24 hours'
    ORDER BY e.seq DESC LIMIT 20`;
  for (const e of audits)
    out.push(
      e.type === "agent.paused"
        ? { category: "account_pause", severity: "info", title: `${e.name ?? "An agent"} was paused`, fingerprint: `pause:${e.event_id}`, evidence: { audit_event_id: e.event_id, agent_id: e.actor_agent_id, at: e.created_at } }
        : { category: "emergency_stop", severity: "critical", title: "Emergency stop engaged", fingerprint: `stop:${e.event_id}`, evidence: { audit_event_id: e.event_id, at: e.created_at } },
    );
  return out;
}

/** Stores candidates as findings (one open finding per fingerprint) and announces new ones. */
async function record(orgId: string, list: Candidate[], source: "detector" | "agent" | "operator", runId: string | null = null): Promise<Row[]> {
  const created: Row[] = [];
  for (const c of list) {
    const [row] = await db()`
      INSERT INTO security_findings (org_id, category, severity, title, evidence, fingerprint, source, agent_run_id)
      VALUES (${orgId}::uuid, ${c.category}, ${c.severity}, ${c.title}, ${JSON.stringify(c.evidence)}::text::jsonb, ${c.fingerprint}, ${source}, ${runId}::uuid)
      ON CONFLICT (org_id, fingerprint) WHERE status <> 'resolved'
      DO UPDATE SET evidence = EXCLUDED.evidence, title = EXCLUDED.title, severity = EXCLUDED.severity, updated_at = now(),
        occurrences = security_findings.occurrences + CASE WHEN security_findings.evidence = EXCLUDED.evidence THEN 0 ELSE 1 END
      RETURNING id, category, severity, title, evidence, (xmax = 0) AS inserted`;
    if (row?.inserted) created.push(row);
  }
  await Promise.all(created.map((f) => emit(orgId, "security.finding", { finding_id: f.id, category: f.category, severity: f.severity, title: f.title })));
  return created;
}

/** Runs detection unless it ran for this organization in the last 30 seconds. Never throws. */
export async function detect(orgId: string, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - (lastRun.get(orgId) ?? 0) < MIN_INTERVAL_MS) return;
  lastRun.set(orgId, now);
  try {
    await record(orgId, await candidates(orgId), "detector");
  } catch {
    lastRun.delete(orgId);
  }
}

export async function listFindings(orgId: string, params: URLSearchParams = new URLSearchParams()) {
  const status = params.get("status");
  if (status !== null && !["open", "acknowledged", "resolved"].includes(status)) throw new BadRequest("status must be open, acknowledged or resolved");
  const category = params.get("category");
  if (category !== null && !(CATEGORIES as readonly string[]).includes(category)) throw new BadRequest("unknown category");
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 50) || 50, 1), 100);
  return db()`
    SELECT f.id, f.category, f.severity, f.title, f.evidence, f.source, f.agent_run_id, f.status, f.occurrences, f.created_at, f.updated_at,
      u.address AS decided_by
    FROM security_findings f LEFT JOIN users u ON u.id = f.decided_by
    WHERE f.org_id = ${orgId}::uuid AND (${status}::text IS NULL OR f.status = ${status}::text)
      AND (${category}::text IS NULL OR f.category = ${category}::text)
    ORDER BY (f.status = 'open') DESC, CASE f.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, f.updated_at DESC
    LIMIT ${limit}::int`;
}

export async function listSecurityEvents(ctx: MemberContext, params: URLSearchParams) {
  await detect(ctx.orgId, params.get("refresh") === "1");
  return { findings: await listFindings(ctx.orgId, params) };
}

export async function setFindingStatus(ctx: MemberContext, id: string, status: unknown) {
  if (status !== "acknowledged" && status !== "resolved" && status !== "open") throw new BadRequest("status must be open, acknowledged or resolved");
  const rows = await db()`
    WITH f AS (
      UPDATE security_findings SET status = ${status}, decided_by = ${ctx.user.userId}::uuid, updated_at = now()
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id, category
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, 'security_finding.' || ${status}::text, jsonb_build_object('finding_id', id, 'category', category) FROM f
    )
    SELECT id FROM f`;
  if (rows.length === 0) throw new HttpError(404, "PS_REQUEST_001", "Finding not found in this organization");
  return { id, status };
}

/** An alert raised by the native agent or an operator, with the evidence it cites. */
export async function raiseFinding(
  orgId: string,
  input: { category: Category; severity: Severity; title: string; evidence: Record<string, unknown> },
  source: "agent" | "operator",
  runId: string | null,
) {
  const fp = `${source}:${input.category}:${input.title.toLowerCase().replace(/\s+/g, " ").slice(0, 120)}`;
  const created = await record(orgId, [{ ...input, fingerprint: fp }], source, runId);
  const [row] = await db()`SELECT id, status, occurrences FROM security_findings WHERE org_id = ${orgId}::uuid AND fingerprint = ${fp} AND status <> 'resolved'`;
  return { id: row?.id ?? null, created: created.length > 0, status: row?.status ?? null };
}

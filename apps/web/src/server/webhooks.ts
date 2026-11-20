import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { MemberContext } from "./access";
import { db, type Row } from "./db";
import { BadRequest, HttpError, logEvent } from "./http";
import { decryptSecret, encryptSecret, hmacHex } from "./secrets";
import { randomHex } from "./tokens";

/*
 * Webhooks (PALISEC Connect). An event is written once per subscribed webhook (UNIQUE event_id per
 * webhook), then delivered with an HMAC-SHA256 signature. Retries reuse the same event ID, so a
 * receiver that deduplicates on Palisec-Event-Id never acts twice. Delivery happens after the
 * response; a webhook can never delay or change an authorization decision.
 */

export const EVENT_TYPES = [
  "operation.allowed",
  "operation.denied",
  "operation.review_required",
  "approval.approved",
  "approval.rejected",
  "organization.emergency_stop",
  "agent.status_changed",
  "credential.revoked",
  "security.finding",
  "operation.submitted",
  "operation.executed",
  // Phase 6: a weakening change is waiting (with its diff and effective_at), took effect, or was cancelled.
  "policy.loosening_pending",
  "policy.loosening_applied",
  "policy.loosening_cancelled",
  // Phase 7: holder mandates.
  "mandate.proposal_created",
  "mandate.vote_closed",
  "mandate.applied",
  "mandate.cancelled",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const MAX_WEBHOOKS = 10;
const ATTEMPTS = 3;
const TIMEOUT_MS = 5000;

// ---------------------------------------------------------------- destination safety (SSRF)

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateAddress(mapped[1]!);
    // URL parsing rewrites ::ffff:127.0.0.1 as ::ffff:7f00:1, so the hex form must be decoded too.
    const hexMapped = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1]!, 16), lo = parseInt(hexMapped[2]!, 16);
      return privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    // Other IPv4-embedding forms (IPv4-compatible ::a.b.c.d / ::x:y, NAT64 64:ff9b::/96) are refused outright.
    return /^::[0-9a-f.:]*$/.test(v) || v.startsWith("64:ff9b:");
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

/**
 * One extra origin for the local end-to-end suite's receiver (e.g. http://127.0.0.1:4555). Ignored on
 * Vercel, so it can never open the production server to internal addresses.
 */
function testOrigin(): string | null {
  const o = process.env.PALISEC_TEST_WEBHOOK_ORIGIN;
  return o && process.env.VERCEL !== "1" ? o : null;
}

/** Only public HTTPS destinations: no internal hosts, private ranges or metadata endpoints. */
export async function checkDestination(raw: unknown): Promise<string> {
  if (typeof raw !== "string" || raw.length > 500) throw new BadRequest("url must be an https URL of at most 500 characters");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequest("url must be an https URL");
  }
  if (testOrigin() !== null && u.origin === testOrigin()) return u.toString();
  if (u.protocol !== "https:" || u.username || u.password) throw new BadRequest("url must be an https URL without credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes("."))
    throw new BadRequest("url must be a public host");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.length === 0) throw new BadRequest("url host does not resolve");
  if (addrs.some(privateAddress)) throw new BadRequest("url must not point to a private or internal address");
  return u.toString();
}

function parseEvents(v: unknown): EventType[] {
  if (!Array.isArray(v) || v.length === 0) throw new BadRequest(`events must be a non-empty array of: ${EVENT_TYPES.join(", ")}`);
  const out = [...new Set(v)];
  for (const e of out) if (!(EVENT_TYPES as readonly unknown[]).includes(e)) throw new BadRequest(`Unknown event type: ${String(e).slice(0, 64)}`);
  return out as EventType[];
}

// ---------------------------------------------------------------- management (members)

export async function listWebhooks(ctx: MemberContext) {
  return db()`
    SELECT w.id, w.url, w.description, w.events, w.secret_prefix, w.status, w.created_at, w.last_delivery_at, w.consecutive_failures,
      (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.created_at > now() - interval '24 hours')::int AS deliveries_24h,
      (SELECT count(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id AND d.status = 'failed' AND d.created_at > now() - interval '24 hours')::int AS failed_24h
    FROM webhooks w WHERE w.org_id = ${ctx.orgId}::uuid ORDER BY w.created_at`;
}

/** Creates a webhook. The signing secret is returned once. */
export async function createWebhook(ctx: MemberContext, body: Record<string, unknown>) {
  const url = await checkDestination(body.url);
  const events = parseEvents(body.events);
  const description = body.description === undefined ? null : String(body.description).slice(0, 120);
  const secret = `whsec_${randomHex(24)}`;
  const enc = await encryptSecret(secret);
  const rows = await db()`
    WITH n AS (SELECT count(*) AS c FROM webhooks WHERE org_id = ${ctx.orgId}::uuid),
    w AS (
      INSERT INTO webhooks (org_id, url, description, events, secret_enc, secret_prefix, created_by)
      SELECT ${ctx.orgId}::uuid, ${url}, ${description}, ${events}::text[], decode(${Buffer.from(enc).toString("hex")}, 'hex'), ${secret.slice(0, 12)}, ${ctx.user.userId}::uuid
      FROM n WHERE n.c < ${MAX_WEBHOOKS}
      RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, 'webhook.created', jsonb_build_object('webhook_id', id, 'url', ${url}::text) FROM w
    )
    SELECT id FROM w`;
  if (rows.length === 0) throw new HttpError(409, "PS_REQUEST_001", `An organization can have at most ${MAX_WEBHOOKS} webhooks`);
  return { id: rows[0]!.id, url, events, secret, note: "Store this signing secret now. It is not shown again." };
}

export async function updateWebhook(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const events = body.events === undefined ? null : parseEvents(body.events);
  const status = body.status === undefined ? null : body.status;
  if (status !== null && status !== "active" && status !== "disabled") throw new BadRequest('status must be "active" or "disabled"');
  const rows = await db()`
    WITH w AS (
      UPDATE webhooks SET events = coalesce(${events}::text[], events), status = coalesce(${status}::text, status),
        consecutive_failures = CASE WHEN ${status}::text = 'active' THEN 0 ELSE consecutive_failures END
      WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id, status
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, 'webhook.updated', jsonb_build_object('webhook_id', id, 'status', status) FROM w
    )
    SELECT id FROM w`;
  if (rows.length === 0) throw new HttpError(404, "PS_REQUEST_001", "Webhook not found in this organization");
  return (await listWebhooks(ctx)).find((w) => w.id === id);
}

export async function deleteWebhook(ctx: MemberContext, id: string) {
  const rows = await db()`
    WITH w AS (DELETE FROM webhooks WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id, org_id, url),
    e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, 'webhook.deleted', jsonb_build_object('webhook_id', id, 'url', url) FROM w
    )
    SELECT id FROM w`;
  if (rows.length === 0) throw new HttpError(404, "PS_REQUEST_001", "Webhook not found in this organization");
  return { id, deleted: true };
}

export async function listDeliveries(ctx: MemberContext, webhookId: string) {
  return db()`
    SELECT d.id, d.event_id, d.event_type, d.status, d.attempts, d.last_status, d.last_error, d.created_at, d.delivered_at
    FROM webhook_deliveries d WHERE d.webhook_id = ${webhookId}::uuid AND d.org_id = ${ctx.orgId}::uuid
    ORDER BY d.created_at DESC LIMIT 50`;
}

// ---------------------------------------------------------------- emission and delivery

/**
 * Records an event for every active webhook subscribed to it, then delivers. Call it after the
 * response (`after()`); it never throws.
 */
export async function emit(orgId: string, type: EventType, data: Record<string, unknown>): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    const payload = { id: eventId, type, created_at: new Date().toISOString(), organization_id: orgId, data };
    const rows = await db()`
      INSERT INTO webhook_deliveries (webhook_id, org_id, event_id, event_type, payload)
      SELECT id, org_id, ${eventId}::uuid, ${type}, ${JSON.stringify(payload)}::text::jsonb
      FROM webhooks WHERE org_id = ${orgId}::uuid AND status = 'active' AND ${type} = ANY(events)
      ON CONFLICT (webhook_id, event_id) DO NOTHING
      RETURNING id`;
    await Promise.all(rows.map((r) => deliver(r.id as string)));
  } catch (err) {
    logEvent("error", "webhook.emit_failed", { type, error: err instanceof Error ? err.message.slice(0, 200) : "error" });
  }
}

/** Sends one delivery, retrying transient failures. Idempotent: a delivered row is never sent again. */
export async function deliver(deliveryId: string): Promise<Row | null> {
  const [d] = await db()`
    SELECT d.id, d.event_id, d.event_type, d.payload, d.status, w.url, encode(w.secret_enc, 'hex') AS secret_hex, w.id AS webhook_id
    FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = ${deliveryId}::uuid`;
  if (!d || d.status === "delivered") return d ?? null;
  const secret = await decryptSecret(Uint8Array.from(Buffer.from(String(d.secret_hex), "hex")));
  const body = JSON.stringify(d.payload);
  let status: number | null = null;
  let error: string | null = null;
  let tried = 0;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const ts = Math.floor(Date.now() / 1000).toString();
    tried = attempt;
    try {
      await checkDestination(d.url);
      const res = await fetch(d.url, {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "content-type": "application/json",
          "user-agent": "Palisec-Webhooks/1.0",
          "palisec-event-id": String(d.event_id),
          "palisec-event-type": String(d.event_type),
          "palisec-timestamp": ts,
          "palisec-signature": `v1=${await hmacHex(secret, `${ts}.${body}`)}`,
        },
        body,
      });
      status = res.status;
      error = res.ok ? null : `HTTP ${res.status}`;
      await res.body?.cancel().catch(() => {});
      if (res.ok || (res.status < 500 && res.status !== 429)) break;
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 300) : "delivery failed";
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  const ok = status !== null && status >= 200 && status < 300;
  const [row] = await db()`
    WITH d AS (
      UPDATE webhook_deliveries SET status = ${ok ? "delivered" : "failed"}, attempts = attempts + ${tried}::int, last_status = ${status}::int,
        last_error = ${error}, delivered_at = CASE WHEN ${ok} THEN now() ELSE delivered_at END
      WHERE id = ${deliveryId}::uuid AND status <> 'delivered' RETURNING id, webhook_id, status, attempts, last_status, last_error
    ), w AS (
      UPDATE webhooks SET last_delivery_at = now(),
        consecutive_failures = CASE WHEN ${ok} THEN 0 ELSE consecutive_failures + 1 END,
        -- Twenty failed events in a row disable the webhook until a member re-enables it.
        status = CASE WHEN NOT ${ok} AND consecutive_failures + 1 >= 20 THEN 'disabled' ELSE status END
      WHERE id IN (SELECT webhook_id FROM d)
    )
    SELECT * FROM d`;
  return row ?? null;
}

/** Sends a delivery again with the same event ID (manual retry from the console). */
export async function redeliver(ctx: MemberContext, deliveryId: string) {
  const rows = await db()`
    UPDATE webhook_deliveries SET status = 'pending' WHERE id = ${deliveryId}::uuid AND org_id = ${ctx.orgId}::uuid AND status = 'failed' RETURNING id`;
  if (rows.length === 0) throw new HttpError(409, "PS_REQUEST_001", "Only a failed delivery in this organization can be sent again");
  return deliver(deliveryId);
}

/** Sends a `ping` straight away so a receiver can be tested. */
export async function pingWebhook(ctx: MemberContext, webhookId: string) {
  const eventId = crypto.randomUUID();
  const payload = { id: eventId, type: "ping", created_at: new Date().toISOString(), organization_id: ctx.orgId, data: {} };
  const rows = await db()`
    INSERT INTO webhook_deliveries (webhook_id, org_id, event_id, event_type, payload)
    SELECT id, org_id, ${eventId}::uuid, 'ping', ${JSON.stringify(payload)}::text::jsonb FROM webhooks
    WHERE id = ${webhookId}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING id`;
  if (rows.length === 0) throw new HttpError(404, "PS_REQUEST_001", "Webhook not found in this organization");
  return deliver(rows[0]!.id as string);
}

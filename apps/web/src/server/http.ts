import "server-only";
import { unstable_rethrow } from "next/navigation";
import { allowedHosts } from "./config";
import { StateUnavailable } from "./db";

export const MAX_BODY_BYTES = 16 * 1024;

export function requestId(): string {
  return `rw_req_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** Error envelope shared by every endpoint: a stable code plus a safe explanation. */
export function apiError(status: number, code: string, message: string, retryable = false) {
  return Response.json(
    { request_id: requestId(), error: { code, message, retryable } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function ok(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export class BadRequest extends Error {}

/** Parses a bounded JSON object body. */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) throw new BadRequest("Request body too large");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequest("Request body too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequest("Body must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BadRequest("Body must be a JSON object");
  return parsed as Record<string, unknown>;
}

/** Host names for this request, most specific first. Proxies differ in which they forward. */
function requestHosts(req: Request): string[] {
  const originHost = () => {
    try {
      return new URL(req.headers.get("origin") ?? "").host;
    } catch {
      return "";
    }
  };
  return [req.headers.get("x-forwarded-host")?.split(",")[0]?.trim(), req.headers.get("host"), originHost()]
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase());
}

/** The host a sign-in message may name: only ever a value from the allowlist. */
export function trustedHost(req: Request): string | null {
  const allowed = allowedHosts();
  return requestHosts(req).find((h) => allowed.includes(h)) ?? null;
}

/**
 * CSRF guard for cookie-authenticated state changes: the Origin must be this deployment.
 * SameSite=Lax on the cookie is the second layer.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const o = new URL(origin);
    return allowedHosts().includes(o.host.toLowerCase());
  } catch {
    return false;
  }
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Per-address limit, in this process's memory. It protects the database's free quota from abuse; it is
 * not a security boundary, and resets on restart. Requests with no visible address share one bucket.
 */
export function rateLimited(req: Request, name: string, limit: number, windowMs = 60_000): boolean {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${name}:${ip}`;
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > 10_000) buckets.clear();
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

export const tooManyRequests = () => apiError(429, "RW_RATE_001", "Too many requests. Try again in a minute.", true);

/** Maps thrown errors to fail-closed responses. Unknown errors never leak internals. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      // Next signals prerender bailouts and redirects by throwing; those are not failures.
      unstable_rethrow(err);
      if (err instanceof BadRequest) return apiError(400, "RW_REQUEST_001", err.message);
      if (err instanceof StateUnavailable) return apiError(503, "RW_STATE_001", "Authoritative state unavailable", true);
      // Name and message only: request bodies and headers may carry credentials.
      console.error("[api] unhandled", err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "error");
      return apiError(503, "RW_STATE_001", "Authoritative state unavailable", true);
    }
  };
}

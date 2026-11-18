import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_rethrow } from "next/navigation";
import { allowedHosts } from "./config";
import { StateUnavailable } from "./db";

export const MAX_BODY_BYTES = 16 * 1024;
/** JSON nesting deeper than any valid document; deeper input is refused before it reaches Postgres. */
const MAX_JSON_DEPTH = 32;
/** Seconds a client should wait after a 429. Limits use one-minute windows. */
const RETRY_AFTER_SECONDS = 60;

const context = new AsyncLocalStorage<{ id: string }>();

const newRequestId = () => `ps_req_${crypto.randomUUID().replaceAll("-", "")}`;

/** This request's ID: the same value in the X-Request-Id header, error bodies and server logs. */
export function requestId(): string {
  return context.getStore()?.id ?? newRequestId();
}

/** Error envelope shared by every endpoint: a stable code plus a safe explanation. */
export function apiError(status: number, code: string, message: string, retryable = false) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (status === 429) headers["Retry-After"] = String(RETRY_AFTER_SECONDS);
  return Response.json({ request_id: requestId(), error: { code, message, retryable } }, { status, headers });
}

/** One JSON line per event, so logs can be searched by request ID. Never pass bodies or headers. */
export function logEvent(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, event, request_id: context.getStore()?.id, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function ok(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export class BadRequest extends Error {}

/** A refusal with a stable code, thrown from deep inside a handler. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

/** Reads at most `maxBytes` of body, counting bytes as they arrive (chunked bodies included). */
async function readBounded(req: Request, maxBytes: number): Promise<string> {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > maxBytes) throw new BadRequest("Request body too large");
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BadRequest("Request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BadRequest("Body must be UTF-8");
  }
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * Text the database can store, at a depth no valid document needs. NUL characters and unpaired
 * surrogates are refused here as bad requests instead of failing later as a storage error.
 */
function checkJson(v: unknown, depth = 0): void {
  if (depth > MAX_JSON_DEPTH) throw new BadRequest(`JSON nested deeper than ${MAX_JSON_DEPTH} levels`);
  const text = (s: string) => {
    if (s.includes("\u0000")) throw new BadRequest("Text must not contain NUL characters");
    if (LONE_SURROGATE.test(s)) throw new BadRequest("Text must be valid Unicode");
  };
  if (typeof v === "string") return text(v);
  if (Array.isArray(v)) return v.forEach((x) => checkJson(x, depth + 1));
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      text(k);
      checkJson(x, depth + 1);
    }
}

/** Parses a bounded JSON object body. */
export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const text = await readBounded(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BadRequest("Body must be JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BadRequest("Body must be a JSON object");
  checkJson(parsed);
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
  // Vercel sets x-real-ip and x-forwarded-for itself and overwrites client-supplied values; no other
  // client header (e.g. cf-connecting-ip, which only means something behind Cloudflare) is trusted.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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

export const tooManyRequests = () => apiError(429, "PS_RATE_001", "Too many requests. Try again in a minute.", true);

const SLOW_MS = 5_000;

/**
 * Wraps a route: one request ID for the header, the error body and the logs; thrown errors mapped
 * to fail-closed responses that never leak internals; failures and slow requests logged as JSON.
 */
export function handle<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const id = newRequestId();
    return context.run({ id }, async () => {
      const started = Date.now();
      const path = new URL(req.url).pathname; // never the query string
      let res: Response;
      try {
        res = await fn(req, ctx);
      } catch (err) {
        // Next signals prerender bailouts and redirects by throwing; those are not failures.
        unstable_rethrow(err);
        if (err instanceof BadRequest) res = apiError(400, "PS_REQUEST_001", err.message);
        else if (err instanceof HttpError) res = apiError(err.status, err.code, err.message, err.retryable);
        else if (err instanceof StateUnavailable) res = apiError(503, "PS_STATE_001", "Authoritative state unavailable", true);
        else {
          // Name and message only: request bodies and headers may carry credentials.
          logEvent("error", "api.unhandled", { method: req.method, path, error: err instanceof Error ? `${err.name}: ${err.message.slice(0, 200)}` : "error" });
          res = apiError(503, "PS_STATE_001", "Authoritative state unavailable", true);
        }
      }
      try {
        res.headers.set("X-Request-Id", id);
      } catch {
        // Redirect responses have immutable headers.
      }
      const ms = Date.now() - started;
      if (res.status >= 500) logEvent("error", "api.failed", { method: req.method, path, status: res.status, ms });
      else if (ms > SLOW_MS) logEvent("warn", "api.slow", { method: req.method, path, status: res.status, ms });
      return res;
    });
  };
}

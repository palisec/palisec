import "server-only";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "./config";
import { db } from "./db";

export type Role = "owner" | "admin" | "operator" | "approver" | "viewer";

export interface SessionUser {
  sessionId: string;
  userId: string;
  address: string;
  memberships: { orgId: string; orgName: string; role: Role }[];
}

function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hex, not bytes, so the value passes through every database driver unchanged. */
async function sha256Hex(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export const clearedSessionCookie = () => sessionCookie("", 0);

/** Creates a session row and returns the raw token, which only ever exists in the cookie. */
export async function createSession(userId: string): Promise<string> {
  const token = newToken();
  await db()`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (decode(${await sha256Hex(token)}, 'hex'), ${userId}, now() + make_interval(secs => ${SESSION_TTL_SECONDS}::int))`;
  return token;
}

/** Resolves the caller's session. Expired, revoked or unknown tokens yield null. */
export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const rows = await db()`
    SELECT s.id AS session_id, u.id AS user_id, u.address
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = decode(${await sha256Hex(token)}, 'hex') AND s.revoked_at IS NULL AND s.expires_at > now()`;
  if (rows.length === 0) return null;
  const { session_id, user_id, address } = rows[0];
  const memberships = await db()`
    SELECT m.org_id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
    WHERE m.user_id = ${user_id} ORDER BY m.created_at`;
  return {
    sessionId: session_id,
    userId: user_id,
    address,
    memberships: memberships.map((m) => ({ orgId: m.org_id, orgName: m.name, role: m.role as Role })),
  };
}

export async function revokeSession(sessionId: string) {
  await db()`UPDATE sessions SET revoked_at = now() WHERE id = ${sessionId} AND revoked_at IS NULL`;
}

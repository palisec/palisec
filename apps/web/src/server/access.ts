import "server-only";
import { db } from "./db";
import { HttpError, rateLimited, sameOrigin } from "./http";
import { currentUser, type Role, type SessionUser } from "./session";
import { sha256Hex } from "./tokens";

/**
 * Server-side authorization for every console and agent request (spec §12). The browser only hides
 * controls; these checks are what actually refuse.
 */

export const ROLES = {
  read: ["owner", "admin", "operator", "approver", "viewer"],
  operate: ["owner", "admin", "operator"],
  approve: ["owner", "admin", "approver"],
  manage: ["owner", "admin"],
  own: ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof ROLES;

export interface MemberContext {
  user: SessionUser;
  orgId: string;
  role: Role;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The `[id]` segment of a dynamic route, which must be a UUID. */
export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new HttpError(404, "RW_REQUEST_001", "Not found");
  return id.toLowerCase();
}

/** Agents authenticate with a Bearer key; people with the session cookie. */
export const hasBearer = (req: Request) => (req.headers.get("authorization") ?? "").startsWith("Bearer ");

/**
 * Resolves the signed-in member and checks the permission. The organization is the `x-rw-org` header
 * (or `?org=`), defaulting to the first one the user belongs to. State changes must come from this
 * site's origin (CSRF protection for cookie sessions).
 */
export async function requireMember(req: Request, permission: Permission): Promise<MemberContext> {
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (mutating && !sameOrigin(req)) throw new HttpError(403, "RW_AUTH_001", "Cross-origin request rejected");
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "RW_AUTH_001", "Not signed in");
  const wanted = req.headers.get("x-rw-org") ?? new URL(req.url).searchParams.get("org");
  const membership = wanted ? user.memberships.find((m) => m.orgId === wanted) : user.memberships[0];
  if (!membership) throw new HttpError(403, "RW_AUTH_001", "You are not a member of this organization");
  if (!(ROLES[permission] as readonly Role[]).includes(membership.role))
    throw new HttpError(403, "RW_AUTH_001", `The ${membership.role} role cannot perform this action`);
  return { user, orgId: membership.orgId, role: membership.role };
}

export interface AgentContext {
  credentialId: string;
  agentId: string;
  orgId: string;
  agentName: string;
  agentStatus: "active" | "paused" | "revoked";
  chainId: number;
  account: `0x${string}`;
  policyId: string | null;
  emergencyStop: boolean;
}

/** API keys look like rw_test_ followed by 48 hex characters (192 random bits). */
export const API_KEY_PATTERN = /^rw_test_[0-9a-f]{48}$/;

/**
 * Authenticates an agent's API key from `Authorization: Bearer …`. Keys are never accepted in URLs.
 * Revoked keys and keys of revoked agents fail. Usage time is recorded at most once a minute.
 */
export async function requireAgent(req: Request): Promise<AgentContext> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!API_KEY_PATTERN.test(key)) throw new HttpError(401, "RW_AUTH_001", "Missing or malformed API key");
  if (rateLimited(req, `key:${key.slice(0, 20)}`, 120)) throw new HttpError(429, "RW_RATE_001", "Too many requests for this API key", true);
  const rows = await db()`
    WITH c AS (
      SELECT c.id, c.agent_id FROM api_credentials c
      WHERE c.secret_hash = decode(${await sha256Hex(key)}, 'hex') AND c.revoked_at IS NULL
    ), touch AS (
      UPDATE api_credentials SET last_used_at = now()
      WHERE id IN (SELECT id FROM c) AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
    )
    SELECT c.id AS credential_id, a.id AS agent_id, a.org_id, a.name, a.status, a.chain_id, a.account, a.policy_id, o.emergency_stop
    FROM c JOIN agents a ON a.id = c.agent_id JOIN organizations o ON o.id = a.org_id`;
  const r = rows[0];
  if (!r || r.status === "revoked") throw new HttpError(401, "RW_AUTH_001", "API key is unknown or revoked");
  return {
    credentialId: r.credential_id,
    agentId: r.agent_id,
    orgId: r.org_id,
    agentName: r.name,
    agentStatus: r.status,
    chainId: Number(r.chain_id),
    account: r.account,
    policyId: r.policy_id,
    emergencyStop: r.emergency_stop,
  };
}

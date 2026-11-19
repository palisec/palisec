import "server-only";
import { BILLING, LIMITS } from "@/lib/billing-config";
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
  if (!isUuid(id)) throw new HttpError(404, "PS_REQUEST_001", "Not found");
  return id.toLowerCase();
}

/** Agents authenticate with a Bearer key; people with the session cookie. */
export const hasBearer = (req: Request) => (req.headers.get("authorization") ?? "").startsWith("Bearer ");

/**
 * Resolves the signed-in member and checks the permission. The organization is the `x-ps-org` header
 * (or `?org=`), defaulting to the first one the user belongs to. State changes must come from this
 * site's origin (CSRF protection for cookie sessions).
 */
export async function requireMember(req: Request, permission: Permission): Promise<MemberContext> {
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  if (mutating && !sameOrigin(req)) throw new HttpError(403, "PS_AUTH_001", "Cross-origin request rejected");
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, "PS_AUTH_001", "Not signed in");
  if (mutating && rateLimited(req, `member:${user.userId}`, 60)) throw new HttpError(429, "PS_RATE_001", "Too many changes. Try again in a minute.", true);
  const wanted = req.headers.get("x-ps-org") ?? new URL(req.url).searchParams.get("org");
  const membership = wanted ? user.memberships.find((m) => m.orgId === wanted) : user.memberships[0];
  if (!membership) throw new HttpError(403, "PS_AUTH_001", "You are not a member of this organization");
  if (!(ROLES[permission] as readonly Role[]).includes(membership.role))
    throw new HttpError(403, "PS_AUTH_001", `The ${membership.role} role cannot perform this action`);
  return { user, orgId: membership.orgId, role: membership.role };
}

/**
 * What an API key may do. Keys created before scopes existed hold all of them, so existing
 * integrations keep working; new keys can be narrowed. A key can never change its own scopes.
 * `authorizations:evaluate` allows dry runs only (the homepage's Live API demo holds such a key).
 */
export const SCOPES = ["operations:write", "operations:read", "policy:read", "audit:read", "mcp", "authorizations:evaluate"] as const;
export type Scope = (typeof SCOPES)[number];
/** A key created without a scope list gets these (dry runs are already part of operations:write). */
export const DEFAULT_SCOPES: Scope[] = ["operations:write", "operations:read", "policy:read", "audit:read", "mcp"];

export interface AgentContext {
  credentialId: string;
  scopes: Scope[];
  agentId: string;
  orgId: string;
  agentName: string;
  agentStatus: "active" | "paused" | "revoked";
  chainId: number;
  account: `0x${string}`;
  policyId: string | null;
  emergencyStop: boolean;
}

/** API keys: ps_live_ (mainnet agents) or ps_test_ (testnet), then 48 hex characters (192 random bits). */
export const API_KEY_PATTERN = /^ps_(?:live|test)_[0-9a-f]{48}$/;

/**
 * Authenticates an agent's API key from `Authorization: Bearer …`. Keys are never accepted in URLs.
 * Revoked keys and keys of revoked agents fail. Usage time is recorded at most once a minute.
 */
export async function requireAgent(req: Request, scope: Scope | null): Promise<AgentContext> {
  const header = req.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!API_KEY_PATTERN.test(key)) throw new HttpError(401, "PS_AUTH_001", "API key is missing, unknown or revoked");
  // The highest plan's limit first (before any database read), then the organization's own plan below.
  if (rateLimited(req, `key:${key.slice(0, 20)}`, LIMITS.pro.apiRequestsPerMinute)) throw new HttpError(429, "PS_RATE_001", "Too many requests for this API key", true);
  const rows = await db()`
    WITH c AS (
      SELECT c.id, c.agent_id, c.scopes FROM api_credentials c
      WHERE c.secret_hash = decode(${await sha256Hex(key)}, 'hex') AND c.revoked_at IS NULL
    ), touch AS (
      UPDATE api_credentials SET last_used_at = now()
      WHERE id IN (SELECT id FROM c) AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')
    )
    SELECT c.id AS credential_id, c.scopes, a.id AS agent_id, a.org_id, a.name, a.status, a.chain_id, a.account, a.policy_id, o.emergency_stop,
      coalesce(b.pro AND b.pro_checked_at > now() - make_interval(secs => ${2 * BILLING.proCheckSeconds}::int), false) AS pro
    FROM c JOIN agents a ON a.id = c.agent_id JOIN organizations o ON o.id = a.org_id LEFT JOIN billing_accounts b ON b.org_id = a.org_id`;
  const r = rows[0];
  if (!r || r.status === "revoked") throw new HttpError(401, "PS_AUTH_001", "API key is missing, unknown or revoked");
  if (!r.pro && rateLimited(req, `keyplan:${key.slice(0, 20)}`, LIMITS.normal.apiRequestsPerMinute))
    throw new HttpError(429, "PS_RATE_001", "Too many requests for this API key", true);
  const scopes = (r.scopes ?? []) as Scope[];
  if (scope !== null && !scopes.includes(scope)) throw new HttpError(403, "PS_AUTH_001", `This API key does not have the ${scope} scope`);
  return {
    credentialId: r.credential_id,
    scopes,
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

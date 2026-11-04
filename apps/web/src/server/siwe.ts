import "server-only";
import { createPublicClient, getAddress, http, isAddress, isHex, verifyMessage, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { CHAINS, CHALLENGE_TTL_SECONDS, VERIFY_CHAIN } from "./config";
import { db } from "./db";
import { BadRequest } from "./http";

const STATEMENT =
  "Sign in to the Palisec console. This is not a transaction: it moves no funds and grants no spending permission.";

export interface Challenge {
  nonce: string;
  message: string;
  expires_at: string;
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseAddress(v: unknown): `0x${string}` {
  if (typeof v !== "string" || !isAddress(v, { strict: false })) throw new BadRequest("address must be a 20-byte hex address");
  return getAddress(v);
}

function parseChainId(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 2 ** 31 - 1) throw new BadRequest("chain_id must be a positive integer");
  return v;
}

/** Issues an EIP-4361 message bound to this host, a fresh nonce and a short expiry. */
export async function issueChallenge(body: Record<string, unknown>, host: string): Promise<Challenge> {
  const address = parseAddress(body.address);
  const chainId = parseChainId(body.chain_id);
  const n = nonce();
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + CHALLENGE_TTL_SECONDS * 1000);
  const scheme = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  const message = createSiweMessage({
    address,
    chainId,
    domain: host,
    uri: `${scheme}://${host}/login`,
    nonce: n,
    version: "1",
    statement: STATEMENT,
    issuedAt,
    expirationTime,
  });
  const sql = db();
  // Opportunistic cleanup keeps the table small without a scheduled job.
  await sql`DELETE FROM auth_challenges WHERE expires_at < now() - interval '1 day'`;
  await sql`
    INSERT INTO auth_challenges (nonce, address, domain, chain_id, message, issued_at, expires_at)
    VALUES (${n}, ${address}, ${host}, ${chainId}::int, ${message}, ${issuedAt.toISOString()}::timestamptz, ${expirationTime.toISOString()}::timestamptz)`;
  return { nonce: n, message, expires_at: expirationTime.toISOString() };
}

export type VerifyResult = { ok: true; userId: string; address: string; created: boolean } | { ok: false; reason: string };

async function signatureValid(address: `0x${string}`, message: string, signature: Hex): Promise<boolean> {
  // EOA signatures verify locally, with no network dependency.
  if (await verifyMessage({ address, message, signature }).catch(() => false)) return true;
  // Smart-contract wallets (ERC-1271, or ERC-6492 if undeployed) verify against the chain.
  const chain = CHAINS[VERIFY_CHAIN];
  const client = createPublicClient({ transport: http(chain.rpc, { timeout: 8000, retryCount: 1 }) });
  return client.verifyMessage({ address, message, signature }).catch(() => false);
}

/** Consumes the challenge exactly once, checks the signature, and resolves (or creates) the user. */
export async function verifyChallenge(body: Record<string, unknown>, host: string): Promise<VerifyResult> {
  const n = body.nonce;
  const signature = body.signature;
  if (typeof n !== "string" || !/^[0-9a-f]{32}$/.test(n)) throw new BadRequest("nonce is malformed");
  if (typeof signature !== "string" || !isHex(signature) || signature.length > 4096) throw new BadRequest("signature must be hex");

  const sql = db();
  const rows = await sql`
    UPDATE auth_challenges SET consumed_at = now()
    WHERE nonce = ${n} AND consumed_at IS NULL AND expires_at > now()
    RETURNING address, domain, message`;
  if (rows.length === 0) return { ok: false, reason: "Challenge is unknown, expired or already used" };
  const challenge = rows[0];
  if (challenge.domain !== host) return { ok: false, reason: "Challenge was issued for a different domain" };

  const address = getAddress(challenge.address);
  if (!(await signatureValid(address, challenge.message, signature as Hex))) return { ok: false, reason: "Signature does not match the challenge" };

  // One statement, so it is atomic on every driver: the user, a first-time organization and the audit trail.
  const orgName = `Organization ${address.slice(0, 6)}…${address.slice(-4)}`;
  const [user] = await sql`
    WITH u AS (
      INSERT INTO users (address, last_login) VALUES (${address}, now())
      ON CONFLICT ((lower(address))) DO UPDATE SET last_login = now()
      RETURNING id, (xmax = 0) AS created
    ), new_org AS (
      INSERT INTO organizations (name)
      SELECT ${orgName}::text WHERE NOT EXISTS (SELECT 1 FROM memberships m JOIN u ON m.user_id = u.id)
      RETURNING id
    ), member AS (
      INSERT INTO memberships (org_id, user_id, role)
      SELECT new_org.id, u.id, 'owner' FROM new_org, u
    ), org_audit AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT new_org.id, u.id, 'org.created', ${JSON.stringify({ name_set_by: "sign_in" })}::text::jsonb FROM new_org, u
    ), sign_in_audit AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT (SELECT id FROM new_org), u.id, 'auth.sign_in', ${JSON.stringify({ method: "siwe", domain: host })}::text::jsonb FROM u
    )
    SELECT id, created FROM u`;
  return { ok: true, userId: user.id, address, created: user.created };
}

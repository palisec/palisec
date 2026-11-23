import "server-only";
import type { Policy, ProvenRecordStatus } from "@palisec/policy-schema";
import { summarizeChanges } from "@palisec/policy-schema";
import { createPublicClient, encodeFunctionData, getAddress, isAddress, keccak256, parseAbi, stringToHex, type Address } from "viem";
import { chainTransport, CHAINS, type ChainId } from "./config";
import { db, type Row } from "./db";
import { BadRequest, logEvent } from "./http";
import { announcePending } from "./pending";
import { MAINNET } from "@/lib/networks";

/*
 * Zolva: an agent's track record from Zolva (paper trading), shown next to its Palisec account.
 *
 * - Display only, except for the one engine input `proven_record` (policy schema 1.4), which can only
 *   unlock limits the policy itself names, after the loosening delay.
 * - Reads Zolva's public API, at most once per Zolva agent every 5 minutes (its replay check at most
 *   hourly), claimed in one SQL statement so servers never read twice. 429 is respected; when Zolva is
 *   down the last good data is shown with its time.
 * - The link is two-sided: the Palisec account declares its Zolva agent ID on chain (AgentLinks), and the
 *   Zolva agent names the Palisec account back. Only both together, on an account Palisec enforces, count.
 * - The API key (ZOLVA_API_KEY) is sent only to the fixed Zolva URL below, never returned, logged or stored.
 * - Everything a Zolva user typed is plain text: control characters stripped, length capped, rendered as
 *   text, and never given to the PALISEC Agent.
 */

const ZOLVA_API = "https://zolvaagent.app/api/public/v1";
export const ZOLVA_SITE = "https://zolvaagent.app";
/** AgentLinks (CC0, no owner): accounts declare their agent ID on other services. Same address on any chain. */
export const AGENT_LINKS: Address = "0x737f1AcF46acE6d403977eB4944845fD251fC8C6";
export const ZOLVA_SERVICE = keccak256(stringToHex("zolva"));
export const DISCLAIMER_FALLBACK = "Paper trading with virtual money. Past results do not predict future results. Not investment advice.";
const LINKS_ABI = parseAbi(["function linkOf(address account, bytes32 service) view returns (string)", "function setLink(bytes32 service, string id)"]);
/** Test servers may shorten the cache windows (never production), so the suite need not wait 5 minutes. */
const testSeconds = () => {
  const t = Number(process.env.PALISEC_TEST_ZOLVA_CACHE_SECONDS);
  return testBase() && Number.isInteger(t) && t >= 1 && t < 300 ? t : null;
};
const recordSeconds = () => testSeconds() ?? 300;
const verifySeconds = () => testSeconds() ?? 3600;
const MAX_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Test servers only (never production): a local fake Zolva at http://127.0.0.1:<port>, which also answers
 * the two chain reads (declared ID, enforced account) so the suite needs no chain.
 */
function testBase(): string | null {
  const t = process.env.PALISEC_TEST_ZOLVA_URL;
  return process.env.VERCEL_ENV !== "production" && t && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(t) ? t : null;
}
const apiBase = () => testBase() ?? ZOLVA_API;

export const zolvaConfigured = () => /^zk_[A-Za-z0-9_-]{16,}$/.test(process.env.ZOLVA_API_KEY ?? "");
/** When Zolva last refused the key (this server instance). Public reads then go keyless. */
let keyRefusedAt = 0;
export const zolvaKeyState = (): "configured" | "not_configured" | "refused" =>
  !zolvaConfigured() ? "not_configured" : Date.now() - keyRefusedAt < 3600_000 ? "refused" : "configured";

export function parseZolvaId(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim().toLowerCase();
  if (!UUID.test(s)) throw new BadRequest("zolva_agent_id must be a Zolva agent ID (a UUID)");
  return s;
}

/** Text a Zolva user typed: control characters stripped, whitespace collapsed, length capped. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return s ? (s.length > max ? `${s.slice(0, max - 1)}…` : s) : null;
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const word = (v: unknown, allowed: readonly string[]): string | null => (typeof v === "string" && allowed.includes(v) ? v : null);

type Fetched = { status: number; body: unknown; retryAfter: number | null };

/** One GET to Zolva. The key goes only to the fixed base URL; redirects are refused; size and time are bounded. */
async function zolvaGet(path: string, timeoutMs: number, withKey = true): Promise<Fetched> {
  const headers: Record<string, string> = { accept: "application/json", "user-agent": "palisec/1 (+https://palisec.tech)" };
  const keyed = withKey && zolvaConfigured() && Date.now() - keyRefusedAt >= 3600_000;
  if (keyed) headers.authorization = `Bearer ${process.env.ZOLVA_API_KEY}`;
  const res = await fetch(`${apiBase()}${path}`, { headers, redirect: "error", signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (keyed && res.status === 401) {
    // The key was refused (wrong or revoked). Public data needs no key: read it keyless, and report it.
    keyRefusedAt = Date.now();
    logEvent("warn", "zolva.key_refused", {});
    return zolvaGet(path, timeoutMs, false);
  }
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) throw new Error("zolva_too_large");
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error("zolva_too_large");
  const ra = Number(res.headers.get("retry-after"));
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, retryAfter: Number.isFinite(ra) && ra > 0 ? Math.min(Math.max(ra, 60), 3600) : null };
}

export interface ZolvaDecision { at: string; market: string; action: string; reasoning: string | null }
export interface ZolvaTrade { at: string; market: string; side: string; quantity: number; price: number; cost_usd: number; reason: string | null }
export interface ZolvaRecord {
  id: string;
  name: string | null;
  strategy: string | null;
  markets: string[];
  venue: "spot" | "perps" | null;
  status: "active" | "paused" | null;
  paper: boolean;
  disclaimer: string;
  start_capital_usd: number | null;
  value_usd: number | null;
  return_pct: number | null;
  holding_return_pct: number | null;
  vs_holding_pts: number | null;
  max_drawdown_pct: number | null;
  trades_count: number | null;
  hours_run: number | null;
  last_run_at: string | null;
  url: string;
  /** Hourly [unix seconds, agent value USD, holding value USD], oldest first, at most 7 days. */
  equity: [number, number, number][];
  decisions: ZolvaDecision[];
  trades: ZolvaTrade[];
  /** The Palisec account the Zolva agent names (Zolva's side of the link), or null. */
  palisec_account: { chain_id: number; address: Address } | null;
}
export interface ZolvaVerify { status: "match" | "differs" | "no_history"; verified_since: string | null; hours_verified: number; hours_replayed: number | null; first_difference: string | null }

/** Reduces Zolva's /agents/{id} answer to what Palisec shows. Unknown fields are dropped. */
export function reduceAgent(id: string, raw: unknown): ZolvaRecord | null {
  const top = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const a = top?.agent && typeof top.agent === "object" ? (top.agent as Record<string, unknown>) : null;
  if (!a || a.id !== id) return null;
  const userText = a.userText && typeof a.userText === "object" ? (a.userText as Record<string, unknown>) : {};
  const pa = a.palisecAccount && typeof a.palisecAccount === "object" ? (a.palisecAccount as Record<string, unknown>) : null;
  const paAddr = typeof pa?.address === "string" && isAddress(pa.address, { strict: false }) ? getAddress(pa.address) : null;
  const paChain = typeof pa?.chainId === "number" && Number.isInteger(pa.chainId) ? pa.chainId : null;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const equity = list(top!.equity)
    .map((r) => (Array.isArray(r) ? [Date.parse(String(r[0])) / 1000, num(r[1]), num(r[2])] : null))
    .filter((r): r is [number, number, number] => !!r && Number.isFinite(r[0]) && r[1] !== null && r[2] !== null)
    .slice(-24 * 7);
  const decisions = list(top!.decisions)
    .map((d) => d as Record<string, unknown>)
    .map((d) => ({ at: iso(d.at), market: cleanText(d.market, 24), action: word(d.action, ["buy", "sell", "short", "cover", "hold"]), reasoning: cleanText(d.reasoning, 240) }))
    .filter((d): d is ZolvaDecision => !!d.at && !!d.market && !!d.action)
    .sort((x, y) => (x.at < y.at ? 1 : -1))
    .slice(0, 50);
  const trades = list(top!.trades)
    .map((t) => t as Record<string, unknown>)
    .map((t) => ({
      at: iso(t.at),
      market: cleanText(t.market, 24),
      side: word(t.side, ["buy", "sell", "short", "cover"]),
      quantity: num(t.quantity),
      price: num(t.price),
      cost_usd: num(t.costUsd),
      reason: word(t.reason, ["signal", "stop_loss", "take_profit", "max_hold", "manual", "resize"]),
    }))
    .filter((t): t is ZolvaTrade => !!t.at && !!t.market && !!t.side && t.quantity !== null && t.price !== null && t.cost_usd !== null)
    .slice(0, 50);
  return {
    id,
    name: cleanText(userText.name ?? a.name, 80),
    strategy: cleanText(a.strategyName, 60),
    markets: list(a.markets).map((m) => cleanText(m, 24)).filter((m): m is string => !!m).slice(0, 24),
    venue: word(a.venue, ["spot", "perps"]) as ZolvaRecord["venue"],
    status: word(a.status, ["active", "paused"]) as ZolvaRecord["status"],
    paper: a.paper !== false,
    disclaimer: cleanText(a.disclaimer ?? top!.disclaimer, 300) ?? DISCLAIMER_FALLBACK,
    start_capital_usd: num(a.startCapitalUsd),
    value_usd: num(a.valueUsd),
    return_pct: num(a.returnPct),
    holding_return_pct: num(a.holdingReturnPct),
    vs_holding_pts: num(a.vsHoldingPts),
    max_drawdown_pct: num(a.maxDrawdownPct),
    trades_count: num(a.trades),
    hours_run: num(a.hoursRun),
    last_run_at: iso(a.lastRunAt),
    // Built from the ID, never taken from the response.
    url: `${ZOLVA_SITE}/agents/${id}`,
    equity,
    decisions,
    trades,
    palisec_account: paAddr && paChain ? { chain_id: paChain, address: paAddr } : null,
  };
}

export function reduceVerify(raw: unknown): ZolvaVerify | null {
  const v = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const status = word(v?.status, ["match", "differs", "no_history"]) as ZolvaVerify["status"] | null;
  if (!v || !status) return null;
  const fd = v.firstDifference && typeof v.firstDifference === "object" ? (v.firstDifference as Record<string, unknown>) : null;
  return {
    status,
    verified_since: iso(v.verifiedSince),
    hours_verified: Math.max(0, Math.trunc(num(v.hoursVerified) ?? 0)),
    hours_replayed: num(v.hoursReplayed),
    first_difference: fd ? iso(fd.at ?? fd.hour ?? fd.time) : null,
  };
}

export interface CachedRecord {
  record: ZolvaRecord | null;
  fetched_at: string | null;
  verify: ZolvaVerify | null;
  verified_at: string | null;
  /** Short code of the last failed read, or null. */
  error: string | null;
  error_at: string | null;
}

async function claim(id: string, kind: "record" | "verify", seconds: number): Promise<boolean> {
  const rows =
    kind === "record"
      ? await db()`
        INSERT INTO zolva_cache (zolva_agent_id, claimed_at) VALUES (${id}, now())
        ON CONFLICT (zolva_agent_id) DO UPDATE SET claimed_at = now()
          WHERE (zolva_cache.claimed_at IS NULL OR zolva_cache.claimed_at <= now() - make_interval(secs => ${seconds}))
            AND (zolva_cache.next_allowed_at IS NULL OR zolva_cache.next_allowed_at <= now())
        RETURNING 1 AS ok`
      : await db()`
        INSERT INTO zolva_cache (zolva_agent_id, verify_claimed_at) VALUES (${id}, now())
        ON CONFLICT (zolva_agent_id) DO UPDATE SET verify_claimed_at = now()
          WHERE (zolva_cache.verify_claimed_at IS NULL OR zolva_cache.verify_claimed_at <= now() - make_interval(secs => ${seconds}))
            AND (zolva_cache.next_allowed_at IS NULL OR zolva_cache.next_allowed_at <= now())
        RETURNING 1 AS ok`;
  return rows.length > 0;
}

async function failed(id: string, code: string, retryAfter: number | null, kind: "record" | "verify" = "record") {
  // A failed replay-check read is retried after the record's window (5 minutes), not a full hour.
  const back = kind === "verify" ? verifySeconds() - recordSeconds() : 0;
  await db()`UPDATE zolva_cache SET last_error = ${code}, last_error_at = now(),
    next_allowed_at = CASE WHEN ${retryAfter}::int IS NULL THEN next_allowed_at ELSE now() + make_interval(secs => ${retryAfter ?? 0}) END,
    verify_claimed_at = CASE WHEN ${back}::int > 0 THEN now() - make_interval(secs => ${back}) ELSE verify_claimed_at END
    WHERE zolva_agent_id = ${id}`;
  logEvent("warn", "zolva.read_failed", { code });
}

const codeOf = (e: unknown) =>
  e instanceof Error && e.message === "zolva_too_large" ? "zolva_too_large" : e instanceof Error && e.name === "TimeoutError" ? "zolva_timeout" : "zolva_unavailable";

async function refreshRecord(id: string, timeoutMs: number) {
  if (!(await claim(id, "record", recordSeconds()))) return;
  try {
    const r = await zolvaGet(`/agents/${id}`, timeoutMs);
    if (r.status === 429) return failed(id, "zolva_429", r.retryAfter ?? 60);
    if (r.status === 404) return failed(id, "zolva_not_found", null);
    if (r.status !== 200) return failed(id, `zolva_${r.status >= 500 ? "5xx" : r.status}`, r.retryAfter);
    const rec = reduceAgent(id, r.body);
    if (!rec) return failed(id, "zolva_unclear", null);
    await db()`UPDATE zolva_cache SET record = ${JSON.stringify(rec)}::text::jsonb, fetched_at = now(), last_error = NULL, last_error_at = NULL WHERE zolva_agent_id = ${id}`;
  } catch (e) {
    await failed(id, codeOf(e), null);
  }
}

async function refreshVerify(id: string, timeoutMs: number) {
  if (!(await claim(id, "verify", verifySeconds()))) return;
  try {
    const r = await zolvaGet(`/agents/${id}/verify`, timeoutMs);
    if (r.status === 429) return failed(id, "zolva_429", r.retryAfter ?? 60, "verify");
    if (r.status === 404) return failed(id, "zolva_not_found", null, "verify");
    if (r.status !== 200) return failed(id, `zolva_verify_${r.status >= 500 ? "5xx" : r.status}`, r.retryAfter, "verify");
    const v = reduceVerify(r.body);
    if (!v) return failed(id, "zolva_unclear", null, "verify");
    await db()`UPDATE zolva_cache SET verify = ${JSON.stringify(v)}::text::jsonb, verified_at = now() WHERE zolva_agent_id = ${id}`;
  } catch (e) {
    await failed(id, codeOf(e), null, "verify");
  }
}

/** The cached record, refreshed first when due (at most one read per Zolva agent per 5 minutes). */
export async function zolvaRecord(id: string, opts: { timeoutMs?: number; refresh?: boolean; verify?: boolean } = {}): Promise<CachedRecord> {
  // Zolva's replay check can take seconds uncached: it gets a longer timeout, and the decision path
  // (verify: false) never waits for it; views and the hourly job keep it fresh.
  if (opts.refresh !== false)
    await Promise.all([refreshRecord(id, opts.timeoutMs ?? 5000), opts.verify === false ? null : refreshVerify(id, Math.max(opts.timeoutMs ?? 5000, 10_000))]);
  const [row] = await db()`SELECT record, fetched_at, verify, verified_at, last_error, last_error_at FROM zolva_cache WHERE zolva_agent_id = ${id}`;
  const t = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    record: (row?.record as ZolvaRecord | null) ?? null,
    fetched_at: t(row?.fetched_at),
    verify: (row?.verify as ZolvaVerify | null) ?? null,
    verified_at: t(row?.verified_at),
    error: row?.last_error ?? null,
    error_at: t(row?.last_error_at),
  };
}

/* ───────── The two-sided link ───────── */

const linksClient = (chainId: number) =>
  CHAINS[chainId as ChainId]?.enabled && chainId === MAINNET ? createPublicClient({ transport: chainTransport(chainId as ChainId, 4000) }) : null;

/** The Zolva agent ID the account declared in AgentLinks ("" when none), or null when it cannot be read. */
async function readDeclared(chainId: number, account: Address): Promise<string | null> {
  const test = testBase();
  if (test) {
    const r = await fetch(`${test}/__chain/links/${account.toLowerCase()}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    return r?.ok ? String(((await r.json()) as { id?: string }).id ?? "") : null;
  }
  const c = linksClient(chainId);
  if (!c) return null;
  try {
    return (await c.readContract({ address: AGENT_LINKS, abi: LINKS_ABI, functionName: "linkOf", args: [account, ZOLVA_SERVICE] })) as string;
  } catch {
    return null;
  }
}

/**
 * Whether Palisec enforces the account (the /docs/detect rule: Safe, 4337 module, Palisec co-signer,
 * threshold of at least 2), and its owners. null when it cannot be read.
 */
type AccountFacts = { enforced: boolean; owners: string[] };
const enforcedCache = new Map<string, { at: number; v: AccountFacts | null }>();
async function accountFacts(chainId: number, account: Address): Promise<AccountFacts | null> {
  const key = `${chainId}:${account.toLowerCase()}`;
  const hit = enforcedCache.get(key);
  if (hit && Date.now() - hit.at < recordSeconds() * 1000) return hit.v;
  let v: AccountFacts | null;
  const test = testBase();
  if (test) {
    const r = await fetch(`${test}/__chain/enforced/${account.toLowerCase()}`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    const j = r?.ok ? ((await r.json()) as { enforced?: boolean; owners?: string[] }) : null;
    v = j ? { enforced: j.enforced === true, owners: (j.owners ?? []).map((o) => o.toLowerCase()) } : null;
  } else {
    // Loaded lazily: smart-accounts imports the operations module, which imports this one.
    v = await import("./smart-accounts")
      .then((m) => m.inspectAccount(chainId, account))
      .then((r) => ({ enforced: r.enforced, owners: r.owners.map((o) => o.toLowerCase()) }))
      .catch(() => null);
  }
  enforcedCache.set(key, { at: Date.now(), v });
  return v;
}

/** The declared ID, read from chain at most every 5 minutes per agent (cached on the agent row). */
async function declaredFor(agent: Row): Promise<string | null> {
  const fresh = agent.zolva_declared_read_at && Date.now() - new Date(agent.zolva_declared_read_at).getTime() < recordSeconds() * 1000;
  if (fresh) return agent.zolva_declared_id ?? "";
  const id = await readDeclared(Number(agent.chain_id), getAddress(agent.account));
  if (id !== null) {
    const declared = id.slice(0, 128);
    await db()`UPDATE agents SET zolva_declared_id = ${declared}, zolva_declared_read_at = now() WHERE id = ${agent.id}::uuid`;
    return declared;
  }
  // The chain could not be read: keep the last value only while it is recent, then "unavailable".
  const recent = agent.zolva_declared_read_at && Date.now() - new Date(agent.zolva_declared_read_at).getTime() < 2 * recordSeconds() * 1000;
  return recent ? (agent.zolva_declared_id ?? "") : null;
}

export interface LinkStatus {
  /** Palisec's side, on chain: the account declared this Zolva agent in AgentLinks. */
  palisec_side: "declared" | "not_declared" | "different" | "unavailable";
  declared_id: string | null;
  /** Zolva's side: the Zolva agent names this account. */
  zolva_side: "confirmed" | "waiting" | "different" | "unavailable";
  /** The account is a Palisec smart account Palisec enforces. */
  account_enforced: boolean | null;
  /** A member of this organization is an owner of the account, so the organization controls it. */
  org_controls_account: boolean | null;
  verified: boolean;
  label: string;
}

export async function linkStatus(agent: Row, rec: ZolvaRecord | null): Promise<LinkStatus> {
  const zid = agent.zolva_agent_id as string;
  const [declared, facts, members] = await Promise.all([
    declaredFor(agent),
    accountFacts(Number(agent.chain_id), getAddress(agent.account)),
    import("./upoch").then((m) => m.memberAddresses(agent.org_id)).then((l) => l.map((a) => a.toLowerCase())),
  ]);
  const isEnforced = facts ? facts.enforced : null;
  // Another organization can register an agent on the same account; only an organization one of whose
  // members owns the account can show the link as verified.
  const controls = facts ? facts.owners.some((o) => members.includes(o)) : null;
  const palisec_side = declared === null ? "unavailable" : declared === "" ? "not_declared" : declared.toLowerCase() === zid ? "declared" : "different";
  const pa = rec?.palisec_account ?? null;
  const zolva_side = !rec
    ? "unavailable"
    : !pa
      ? "waiting"
      : pa.chain_id === Number(agent.chain_id) && pa.address.toLowerCase() === String(agent.account).toLowerCase()
        ? "confirmed"
        : "different";
  const verified = palisec_side === "declared" && zolva_side === "confirmed" && isEnforced === true && controls === true;
  const label = verified
    ? "Linked: verified both ways"
    : zolva_side === "different"
      ? "Not linked: the Zolva agent names a different account"
      : palisec_side === "different"
        ? "Not linked: this account declared a different Zolva agent on chain"
        : palisec_side !== "declared"
          ? "Waiting for this account to declare the Zolva agent on chain"
          : zolva_side === "waiting"
            ? "Waiting for Zolva to confirm"
            : isEnforced === false
              ? "Not linked: this account is not enforced by Palisec"
              : controls === false
                ? "Not linked: no member of this organization is an owner of this account"
                : "Link status unavailable right now";
  return { palisec_side, declared_id: declared, zolva_side, account_enforced: isEnforced, org_controls_account: controls, verified, label };
}

/** The transaction the account's owners execute to declare the Zolva agent on chain (value 0, moves nothing). */
export function declaration(agent: Row) {
  const zid = agent.zolva_agent_id as string | null;
  if (!zid || Number(agent.chain_id) !== MAINNET) return null;
  return {
    chain_id: MAINNET,
    from_account: getAddress(agent.account),
    to: AGENT_LINKS,
    value_wei: "0",
    function: "setLink(bytes32 service, string id)",
    args: { service: ZOLVA_SERVICE, id: zid },
    data: encodeSetLink(zid),
    note: "Executed by the account itself (its owners sign it as a Safe transaction). It only records the Zolva agent ID; it moves no funds.",
  };
}

function encodeSetLink(id: string): `0x${string}` {
  return encodeFunctionData({ abi: LINKS_ABI, functionName: "setLink", args: [ZOLVA_SERVICE, id] });
}

/* ───────── Views ───────── */

export interface ZolvaView {
  agent_id: string;
  zolva_agent_id: string | null;
  link: LinkStatus | null;
  record: ZolvaRecord | null;
  verify: ZolvaVerify | null;
  as_of: string | null;
  verify_as_of: string | null;
  unavailable: string | null;
  /** Short code of the last failed read (for the organization's own diagnosis), or null. */
  unavailable_code: string | null;
  declaration: ReturnType<typeof declaration>;
  proven: { unlocked_at: string | null; pending_effective_at: string | null } | null;
  key_configured: boolean;
}

export async function agentRow(orgId: string | null, agentId: string): Promise<Row | null> {
  const [a] = await db()`
    SELECT a.id, a.org_id, a.chain_id, a.account, a.policy_id, a.status, a.zolva_agent_id, a.zolva_declared_id, a.zolva_declared_read_at, a.proven_unlocked_at,
      (SELECT effective_at FROM pending_changes pc WHERE pc.agent_id = a.id AND pc.kind = 'proven_unlock' AND pc.state = 'pending' LIMIT 1) AS proven_pending_at
    FROM agents a WHERE a.id = ${agentId}::uuid AND (${orgId}::uuid IS NULL OR a.org_id = ${orgId}::uuid)`;
  return a ?? null;
}

export async function zolvaView(agent: Row, opts: { refresh?: boolean } = {}): Promise<ZolvaView> {
  const zid = (agent.zolva_agent_id as string | null) ?? null;
  const base: ZolvaView = {
    agent_id: agent.id, zolva_agent_id: zid, link: null, record: null, verify: null, as_of: null, verify_as_of: null, unavailable: null, unavailable_code: null,
    declaration: declaration(agent), proven: null, key_configured: zolvaConfigured(),
  };
  if (!zid) return base;
  const c = await zolvaRecord(zid, { refresh: opts.refresh });
  const link = await linkStatus(agent, c.record);
  return {
    ...base,
    link,
    record: c.record,
    verify: c.verify,
    as_of: c.fetched_at,
    verify_as_of: c.verified_at,
    unavailable: c.error === "zolva_429" ? "Zolva asked us to slow down; showing the last data we read." : c.error ? "Zolva could not be read just now; showing the last data we read." : null,
    unavailable_code: c.error,
    proven: {
      unlocked_at: agent.proven_unlocked_at ? new Date(agent.proven_unlocked_at).toISOString() : null,
      pending_effective_at: agent.proven_pending_at ? new Date(agent.proven_pending_at).toISOString() : null,
    },
  };
}

/* ───────── Proven on Zolva: the unlock lifecycle ───────── */

/** Whether the record qualifies under the policy's rules now (fresh, verified both ways, replay match, enough hours). */
function qualifies(policy: Policy, c: CachedRecord, link: LinkStatus): boolean {
  const rules = policy.proven_record!;
  if (!link.verified || !c.verify || c.verify.status !== "match" || c.verify.hours_verified < rules.min_verified_hours || !c.fetched_at || !c.verified_at) return false;
  return verifyFresh(policy, c) && Date.now() - new Date(c.fetched_at).getTime() <= rules.max_record_age_seconds * 1000;
}

/** The replay check is read hourly, so it may be up to two of its windows old (or the record's own limit, if longer); never older. */
function verifyFresh(policy: Policy, c: CachedRecord): boolean {
  if (!c.verified_at) return false;
  return Date.now() - new Date(c.verified_at).getTime() <= Math.max(policy.proven_record!.max_record_age_seconds, 2 * verifySeconds()) * 1000;
}

/**
 * The engine input for an agent whose policy has `proven_record` on, managing the unlock on the way:
 * a qualifying record with nothing unlocked requests the unlock as a pending loosening (organization's
 * delay, visible, cancellable); a record that stops qualifying locks again at once (a tightening) and
 * cancels any pending unlock. Any failure: null, so the engines keep the policy's own limits.
 */
export async function provenInput(orgId: string, agentId: string, policy: Policy, timeoutMs = 3000): Promise<ProvenRecordStatus | null> {
  try {
    const agent = await agentRow(orgId, agentId);
    if (!agent?.zolva_agent_id) {
      await lock(agent, "no Zolva agent linked");
      return null;
    }
    const c = await zolvaRecord(agent.zolva_agent_id, { timeoutMs, verify: timeoutMs > 3000 });
    const link = await linkStatus(agent, c.record);
    const ok = qualifies(policy, c, link);
    let unlockedAt: Date | null = agent.proven_unlocked_at ? new Date(agent.proven_unlocked_at) : null;
    if (ok && !unlockedAt && !agent.proven_pending_at) await requestUnlock(agent, c);
    if (!ok && (unlockedAt || agent.proven_pending_at)) {
      await lock(agent, "the Zolva record no longer qualifies");
      unlockedAt = null;
    }
    if (!c.fetched_at) return null;
    return {
      observed_at: Math.floor(new Date(c.fetched_at).getTime() / 1000),
      link_verified: link.verified,
      // A stale replay check counts as no history: the engines then keep the policy's own limits.
      replay_status: c.verify && verifyFresh(policy, c) ? c.verify.status : "no_history",
      hours_verified: c.verify?.hours_verified ?? 0,
      unlocked_at: unlockedAt ? Math.floor(unlockedAt.getTime() / 1000) : null,
    };
  } catch (e) {
    logEvent("error", "zolva.proven_failed", { message: e instanceof Error ? e.message.slice(0, 120) : "error" });
    return null;
  }
}

async function requestUnlock(agent: Row, c: CachedRecord) {
  const [o] = await db()`SELECT loosening_delay_seconds FROM organizations WHERE id = ${agent.org_id}::uuid`;
  const delay = Number(o?.loosening_delay_seconds ?? 3600);
  const diff = [{
    path: "$.proven_record", kind: "loosening" as const, from: "policy limits", to: "unlocked limits",
    note: `bigger limits: verified Zolva record (paper trading), ${c.verify?.hours_verified ?? 0} hours verified by replay`,
  }];
  const [{ r }] = await db()`
    SELECT ps_request_pending(${agent.org_id}::uuid, NULL::uuid, 'proven_unlock', ${agent.id}::uuid,
      ${JSON.stringify({ zolva_agent_id: agent.zolva_agent_id })}::text::jsonb, ${JSON.stringify(diff)}::text::jsonb, ${summarizeChanges(diff)}, ${delay}::int) AS r`;
  if (r?.outcome === "pending")
    announcePending(agent.org_id, { pending_change_id: r.pending_change_id, kind: "proven_unlock", agent_id: agent.id, setting: { zolva_agent_id: agent.zolva_agent_id }, summary: summarizeChanges(diff), diff, effective_at: r.effective_at });
}

/** Back to the policy's own limits at once (a tightening), cancelling any pending unlock. One statement. */
export async function lock(agent: Row | null, reason: string) {
  if (!agent || (!agent.proven_unlocked_at && !agent.proven_pending_at)) return;
  await db()`
    WITH a AS (
      UPDATE agents SET proven_unlocked_at = NULL WHERE id = ${agent.id}::uuid RETURNING id, org_id
    ), p AS (
      UPDATE pending_changes SET state = 'cancelled', resolved_at = now(), resolution = 'record no longer qualifies'
      WHERE agent_id = ${agent.id}::uuid AND kind = 'proven_unlock' AND state = 'pending' RETURNING id
    )
    INSERT INTO audit_events (org_id, actor_agent_id, type, detail)
    SELECT org_id, id, 'agent.proven_locked', ${JSON.stringify({ reason })}::text::jsonb FROM a`;
}

/** Hourly: refresh every linked Zolva agent and re-check unlocks. Counts only (the job's log is public). */
export async function refreshLinked(): Promise<{ agents: number; read: number; unavailable: number }> {
  const rows = await db()`
    SELECT a.org_id, a.id, a.zolva_agent_id, pv.document AS policy FROM agents a
    LEFT JOIN policies p ON p.id = a.policy_id AND p.disabled_at IS NULL
    LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE a.zolva_agent_id IS NOT NULL AND a.status <> 'revoked'`;
  let read = 0;
  let unavailable = 0;
  for (const r of rows) {
    const policy = r.policy as Policy | null;
    if (policy?.proven_record?.enabled) await provenInput(r.org_id, r.id, policy, 5000);
    const c = await zolvaRecord(r.zolva_agent_id, { timeoutMs: 5000 });
    if (c.record) read++;
    if (c.error) unavailable++;
  }
  return { agents: rows.length, read, unavailable };
}

/**
 * The public side: the Zolva record of a mandate's agent, only when the link is verified both ways
 * (Palisec's account declared it on chain, Zolva names the account back, and Palisec enforces the
 * account). Anything else: null, and the public page shows nothing about Zolva.
 */
export async function publicZolvaForMandate(slug: string): Promise<{ view: ZolvaView; record: ZolvaRecord } | null> {
  const [m] = await db()`SELECT agent_id FROM mandates WHERE slug = ${slug}`;
  if (!m) return null;
  const agent = await agentRow(null, m.agent_id);
  if (!agent?.zolva_agent_id) return null;
  const view = await zolvaView(agent);
  return view.link?.verified && view.record ? { view, record: view.record } : null;
}

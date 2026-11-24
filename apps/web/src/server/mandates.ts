import "server-only";
import {
  classifyPolicyChange,
  compileProposal,
  outsideEnvelope,
  policyInsideEnvelope,
  proposalTypedData,
  replayBalances,
  summarizeChanges,
  tally,
  validateChange,
  validateEnvelope,
  VOTE_CHOICES,
  voteTypedData,
  type MandateChange,
  type MandateEnvelope,
  type Policy,
  type PolicyChange,
  type VoteChoice,
} from "@palisec/policy-schema";
import { createPublicClient, isAddress, parseAbi, parseAbiItem, recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { MemberContext } from "./access";
import { CHAINS, chainTransport, type ChainId } from "./config";
import { db, type Row } from "./db";
import { afterChange } from "./events";
import { BadRequest, HttpError, logEvent } from "./http";
import { applyDue, cancelPending, orgDelays, requestPending } from "./pending";
import { palisecSigner } from "./smart-accounts";
import { canonicalJson, sha256Hex } from "./tokens";
import { MAINNET } from "@/lib/networks";

/*
 * Holder mandates. Holders of the mandate's token vote with gasless EIP-712 signatures on typed
 * changes inside the owner's envelope. Voting power is the balance at a snapshot block fixed when the
 * proposal opens, rebuilt by replaying the token's Transfer logs (the public RPC keeps old state for only
 * minutes, but logs for good) and cross-checked against the chain while that block is still readable.
 * A passed proposal compiles into an ordinary policy version, activated through ps_activate_policy with
 * the mandate as the actor: tightening at once, loosening after the loosening delay. Anything that cannot
 * be counted, read or compiled changes nothing (fail closed).
 */

/** $PALISEC on Robinhood Chain mainnet: the only token mandates use today. */
export const PALISEC_TOKEN = { address: "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB" as Address, symbol: "PALISEC", startBlock: 116864695n, chainId: MAINNET };

const LOG_STEP = 9_999_999n;
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SLUG = /^[a-z0-9][a-z0-9-]{2,47}$/;
const E18 = 10n ** 18n;

function client(chainId: number) {
  if (!CHAINS[chainId as ChainId]?.enabled) throw new HttpError(503, "PS_CHAIN_001", "Chain unavailable", true);
  return createPublicClient({ transport: chainTransport(chainId as ChainId, 8000) });
}

/** "1000" or "1000.5" tokens (18 decimals) to base units. */
function tokens(v: unknown, field: string): bigint {
  if (typeof v !== "string" || !/^\d{1,30}(\.\d{1,18})?$/.test(v)) throw new BadRequest(`${field} must be a token amount such as "1000"`);
  const [w, f = ""] = v.split(".");
  return BigInt(w!) * E18 + BigInt(f.padEnd(18, "0"));
}

// ---------------------------------------------------------------- snapshot

/**
 * Every holder's balance at `block`, from the token's Transfer logs since its creation. Cross-checked
 * against totalSupply and the largest holders' balanceOf at that block (read now, while the public RPC
 * still has it). Any mismatch throws: the proposal is not opened.
 */
export async function snapshotHolders(chainId: number, token: Address, startBlock: bigint, block: bigint) {
  const c = client(chainId);
  const transfers: { from: string; to: string; value: bigint }[] = [];
  for (let from = startBlock; from <= block; from += LOG_STEP + 1n) {
    const to = from + LOG_STEP > block ? block : from + LOG_STEP;
    const logs = await c.getLogs({ address: token, event: TRANSFER, fromBlock: from, toBlock: to });
    for (const l of logs) transfers.push({ from: l.args.from!, to: l.args.to!, value: l.args.value! });
  }
  const balances = replayBalances(transfers);
  const total = await c.readContract({ address: token, abi: ERC20, functionName: "totalSupply", blockNumber: block });
  let sum = 0n;
  for (const v of balances.values()) {
    if (v < 0n) throw new Error("snapshot: a balance replayed below zero");
    sum += v;
  }
  if (sum !== total) throw new Error(`snapshot: replayed supply ${sum} differs from totalSupply ${total}`);
  const top = [...balances].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).slice(0, 5);
  for (const [addr, bal] of top) {
    const onChain = await c.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [addr as Address], blockNumber: block });
    if (onChain !== bal) throw new Error(`snapshot: balance of ${addr} differs from the chain`);
  }
  return { holders: Object.fromEntries([...balances].map(([k, v]) => [k, v.toString()])), total: total.toString(), transfers: transfers.length };
}

// ---------------------------------------------------------------- owner side

export async function createMandate(ctx: MemberContext, body: Record<string, unknown>) {
  const slug = String(body.slug ?? "");
  if (!SLUG.test(slug)) throw new BadRequest("slug must be 3-48 characters of a-z, 0-9 and -");
  const name = typeof body.name === "string" && body.name.trim().length > 0 && body.name.trim().length <= 80 ? body.name.trim() : null;
  if (!name) throw new BadRequest("name must be 1-80 characters");
  if (typeof body.agent_id !== "string") throw new BadRequest("agent_id is required");
  const period = Number(body.voting_period_seconds);
  if (!Number.isInteger(period) || period < 60 || period > 2592000) throw new BadRequest("voting_period_seconds must be 60 to 2592000");
  const quorum = tokens(body.quorum, "quorum");
  const proposerMin = tokens(body.proposer_min ?? "0", "proposer_min");
  const passBps = Number(body.pass_bps ?? 5000);
  if (!Number.isInteger(passBps) || passBps < 0 || passBps > 9999) throw new BadRequest("pass_bps must be 0 to 9999 (5000 = more than 50%)");
  const errs = validateEnvelope(body.envelope);
  if (errs.length) throw new BadRequest(`envelope: ${errs[0]}`);
  const envelope = body.envelope as MandateEnvelope;
  const [agent] = await db()`
    SELECT a.id, a.chain_id, a.account, a.policy_id, pv.document FROM agents a
    JOIN policies p ON p.id = a.policy_id JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE a.id = ${body.agent_id}::uuid AND a.org_id = ${ctx.orgId}::uuid AND a.status <> 'revoked'`;
  if (!agent) throw new HttpError(404, "PS_REQUEST_001", "Agent with an active policy not found in this organization");
  if (Number(agent.chain_id) !== PALISEC_TOKEN.chainId) throw new BadRequest("Mandates run on Robinhood Chain mainnet, where $PALISEC is");
  const inside = policyInsideEnvelope(agent.document as Policy, envelope);
  if (inside) throw new HttpError(409, "PS_POLICY_001", `The agent's current policy is outside this envelope (${inside}). Tighten the policy or widen the envelope first.`);
  const rows = await db()`
    WITH m AS (
      INSERT INTO mandates (org_id, agent_id, policy_id, slug, name, chain_id, token, token_symbol, token_start_block, voting_period_seconds, quorum, pass_bps, proposer_min, envelope, demo, created_by)
      VALUES (${ctx.orgId}::uuid, ${agent.id}::uuid, ${agent.policy_id}::uuid, ${slug}, ${name}, ${PALISEC_TOKEN.chainId}::int, ${PALISEC_TOKEN.address}, ${PALISEC_TOKEN.symbol},
        ${PALISEC_TOKEN.startBlock.toString()}::bigint, ${period}::int, ${quorum.toString()}::numeric, ${passBps}::int, ${proposerMin.toString()}::numeric,
        ${JSON.stringify(envelope)}::text::jsonb, ${body.demo === true}, ${ctx.user.userId}::uuid)
      ON CONFLICT DO NOTHING RETURNING id, org_id
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT org_id, ${ctx.user.userId}::uuid, 'mandate.created', ${JSON.stringify({ slug, agent_id: agent.id, envelope, voting_period_seconds: period, quorum: quorum.toString(), pass_bps: passBps })}::text::jsonb FROM m
    )
    SELECT id FROM m`;
  if (!rows[0]) throw new HttpError(409, "PS_REQUEST_001", "That slug is taken, or this policy already has a mandate");
  return getMandate(ctx, rows[0].id);
}

export async function listMandates(ctx: MemberContext) {
  await closeDue(ctx.orgId);
  return db()`SELECT m.id, m.slug, m.name, m.demo, m.created_at, a.name AS agent_name, a.account FROM mandates m JOIN agents a ON a.id = m.agent_id WHERE m.org_id = ${ctx.orgId}::uuid ORDER BY m.created_at`;
}

export async function getMandate(ctx: MemberContext, id: string) {
  await closeDue(ctx.orgId);
  const [m] = await db()`SELECT slug FROM mandates WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid`;
  if (!m) throw new HttpError(404, "PS_REQUEST_001", "Mandate not found in this organization");
  return { id, ...(await publicMandate(m.slug)) };
}

/** Envelope changes: tightening applies now; loosening waits out the delay (pending kind mandate_envelope). */
export async function setEnvelope(ctx: MemberContext, id: string, body: Record<string, unknown>) {
  const errs = validateEnvelope(body.envelope);
  if (errs.length) throw new BadRequest(`envelope: ${errs[0]}`);
  const next = body.envelope as MandateEnvelope;
  const [m] = await db()`SELECT envelope FROM mandates WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid`;
  if (!m) throw new HttpError(404, "PS_REQUEST_001", "Mandate not found in this organization");
  const cur = m.envelope as MandateEnvelope;
  const notes: { path: string; kind: "loosening" | "tightening"; from: unknown; to: unknown; note: string }[] = [];
  const cmp = (k: keyof MandateEnvelope, looserIfHigher: boolean, label: string) => {
    const a = BigInt(cur[k] as string), b = BigInt(next[k] as string);
    if (a !== b) notes.push({ path: `$.envelope.${k}`, kind: (b > a) === looserIfHigher ? "loosening" : "tightening", from: cur[k], to: next[k], note: `${label} ${b > a ? "raised" : "lowered"}` });
  };
  cmp("max_transaction_value_wei", true, "envelope per-transaction maximum");
  cmp("max_hourly_budget_usd_micros", true, "envelope hourly budget maximum");
  cmp("min_approval_threshold_usd_micros", false, "envelope approval threshold minimum");
  if (cur.max_transaction_usd_micros !== next.max_transaction_usd_micros) {
    // Absent means a vote cannot set it: adding the field allows more (loosening), removing it allows less.
    const a = cur.max_transaction_usd_micros, b = next.max_transaction_usd_micros;
    const looser = a === undefined || (b !== undefined && BigInt(b) > BigInt(a));
    notes.push({ path: "$.envelope.max_transaction_usd_micros", kind: looser ? "loosening" : "tightening", from: a ?? null, to: b ?? null, note: b === undefined ? "envelope per-transaction USD maximum removed" : a === undefined ? "envelope per-transaction USD maximum set" : `envelope per-transaction USD maximum ${BigInt(b) > BigInt(a) ? "raised" : "lowered"}` });
  }
  const sel = (e: MandateEnvelope) => new Set(e.allowed_contracts.flatMap((c) => c.selectors.map((s) => `${c.address.toLowerCase()}:${s.toLowerCase()}`).concat(`${c.address.toLowerCase()}:*`)));
  const a = sel(cur), b = sel(next);
  for (const x of b) if (!a.has(x)) notes.push({ path: "$.envelope.allowed_contracts", kind: "loosening", from: null, to: x, note: `envelope now allows ${x}` });
  for (const x of a) if (!b.has(x)) notes.push({ path: "$.envelope.allowed_contracts", kind: "tightening", from: x, to: null, note: `envelope no longer allows ${x}` });
  if (notes.length === 0) return getMandate(ctx, id);
  if (notes.some((n) => n.kind === "loosening")) {
    const delays = await orgDelays(ctx.orgId);
    const p = await requestPending(ctx, "mandate_envelope", { setting: { mandate_id: id, envelope: next }, diff: notes, delaySeconds: delays.loosening });
    return { ...(await getMandate(ctx, id)), pending_change: { kind: "mandate_envelope", ...p } };
  }
  await db()`
    WITH u AS (UPDATE mandates SET envelope = ${JSON.stringify(next)}::text::jsonb WHERE id = ${id}::uuid AND org_id = ${ctx.orgId}::uuid RETURNING org_id)
    INSERT INTO audit_events (org_id, actor_user_id, type, detail) SELECT org_id, ${ctx.user.userId}::uuid, 'mandate.envelope_changed', ${JSON.stringify({ mandate_id: id, envelope: next, diff: notes })}::text::jsonb FROM u`;
  return getMandate(ctx, id);
}

/** The safety valve: cancel a passed loosening that is waiting. A reason is required and shown publicly. */
export async function cancelProposal(ctx: MemberContext, id: string, pid: string, body: Record<string, unknown>) {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 200) throw new BadRequest("reason must be 3-200 characters; it is shown on the public mandate page");
  const [p] = await db()`
    SELECT p.pending_change_id, p.number, m.slug FROM mandate_proposals p JOIN mandates m ON m.id = p.mandate_id
    WHERE p.id = ${pid}::uuid AND m.id = ${id}::uuid AND m.org_id = ${ctx.orgId}::uuid`;
  if (!p?.pending_change_id) throw new HttpError(404, "PS_REQUEST_001", "No pending change for this proposal");
  const c = await cancelPending(ctx, p.pending_change_id, `mandate: ${reason}`);
  await db()`INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (${ctx.orgId}::uuid, ${ctx.user.userId}::uuid, 'mandate.cancelled', ${JSON.stringify({ mandate: p.slug, proposal: p.number, reason })}::text::jsonb)`;
  afterChange(ctx.orgId, "mandate.cancelled", { mandate: p.slug, proposal_id: pid, number: p.number, reason });
  return c;
}

// ---------------------------------------------------------------- holder side (public, signed)

async function mandateBySlug(slug: string) {
  if (!SLUG.test(slug)) throw new HttpError(404, "PS_REQUEST_001", "Mandate not found");
  const [m] = await db()`SELECT * FROM mandates WHERE slug = ${slug}`;
  if (!m) throw new HttpError(404, "PS_REQUEST_001", "Mandate not found");
  return m;
}

async function decidingDocument(policyId: string): Promise<{ doc: Policy; version: number } | null> {
  const [r] = await db()`SELECT pv.document, pv.version FROM policies p JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version WHERE p.id = ${policyId}::uuid AND p.disabled_at IS NULL`;
  return r ? { doc: r.document as Policy, version: Number(r.version) } : null;
}

/**
 * Opens a proposal. Body: { title, change, nonce, proposer, signature } where the signature is EIP-712
 * `Proposal{mandate, title, change (canonical JSON), nonce}`. The proposer needs the proposer minimum at
 * the snapshot block, which is fixed now (the latest block), before any vote.
 */
export async function createProposal(slug: string, body: Record<string, unknown>) {
  const m = await mandateBySlug(slug);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 1 || title.length > 120) throw new BadRequest("title must be 1-120 characters");
  const cErr = validateChange(body.change);
  if (cErr.length) throw new BadRequest(`change: ${cErr[0]}`);
  const change = body.change as MandateChange;
  const out = outsideEnvelope(change, m.envelope as MandateEnvelope);
  if (out) throw new HttpError(422, "PS_POLICY_001", `Outside the mandate's envelope: ${out}`);
  const current = await decidingDocument(m.policy_id);
  if (!current) throw new HttpError(409, "PS_POLICY_001", "The mandate's policy has no active version");
  const compiled = compileProposal(current.doc, change, m.envelope as MandateEnvelope);
  if (!compiled.ok) throw new HttpError(422, "PS_POLICY_001", compiled.reason);
  if (typeof body.nonce !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(body.nonce)) throw new BadRequest("nonce must be 1-64 characters");
  if (typeof body.proposer !== "string" || !isAddress(body.proposer)) throw new BadRequest("proposer must be an address");
  if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) throw new BadRequest("signature must be a 65-byte hex signature");
  const signer = await recoverTypedDataAddress({ ...proposalTypedData(Number(m.chain_id), { mandate: slug, title, change: canonicalJson(change), nonce: body.nonce }), signature: body.signature as Hex });
  if (signer.toLowerCase() !== body.proposer.toLowerCase()) throw new HttpError(401, "PS_AUTH_001", "The signature is not the proposer's");
  const c = client(Number(m.chain_id));
  // Fixed now, before any vote can be cast: the latest block, whose state is read and cross-checked at once.
  const snapshotBlock = await c.getBlockNumber();
  // Public RPC nodes behind a load balancer can lag the newest block by a moment, so the same snapshot block is
  // read and cross-checked up to 4 times, 2 s apart. Any mismatch on the last try still opens nothing (fail closed).
  let snap;
  for (let attempt = 1; ; attempt++) {
    try {
      snap = await snapshotHolders(Number(m.chain_id), m.token as Address, BigInt(m.token_start_block), snapshotBlock);
      break;
    } catch (e) {
      logEvent("warn", "mandate.snapshot_failed", { slug, attempt, message: (e as Error).message.slice(0, 200) });
      if (attempt >= 4) throw new HttpError(503, "PS_STATE_001", "The token snapshot could not be read and verified; no proposal was opened.", true);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const power = BigInt(snap.holders[body.proposer.toLowerCase()] ?? "0");
  if (power < BigInt(m.proposer_min)) throw new HttpError(403, "PS_AUTH_001", `The proposer holds ${power} base units at the snapshot block; the minimum is ${m.proposer_min}.`);
  const [row] = await db()`
    WITH n AS (SELECT coalesce(max(number), 0) + 1 AS number FROM mandate_proposals WHERE mandate_id = ${m.id}::uuid),
    p AS (
      INSERT INTO mandate_proposals (mandate_id, number, title, change, proposer, proposer_signature, nonce, snapshot_block, snapshot_total_supply, holders, closes_at)
      SELECT ${m.id}::uuid, n.number, ${title}, ${JSON.stringify(change)}::text::jsonb, ${body.proposer.toLowerCase()}, ${body.signature}, ${body.nonce}, ${snapshotBlock.toString()}::bigint,
        ${snap.total}::numeric, ${JSON.stringify(snap.holders)}::text::jsonb, now() + make_interval(secs => ${Number(m.voting_period_seconds)}) FROM n
      ON CONFLICT DO NOTHING
      RETURNING id, number, closes_at
    ), e AS (
      INSERT INTO audit_events (org_id, actor_user_id, type, detail)
      SELECT ${m.org_id}::uuid, NULL, 'mandate.proposed', jsonb_build_object('mandate', ${slug}::text, 'proposal_id', p.id, 'number', p.number, 'change', ${JSON.stringify(change)}::text::jsonb, 'proposer', ${body.proposer.toLowerCase()}::text, 'snapshot_block', ${snapshotBlock.toString()}::text, 'voting_closes_at', p.closes_at) FROM p
    )
    SELECT id, number, closes_at FROM p`;
  // A signed proposal is single-use: the same proposer and nonce cannot open a second one.
  if (!row) throw new HttpError(409, "PS_REPLAY_001", "This signed proposal (proposer and nonce) was already used");
  afterChange(m.org_id, "mandate.proposal_created", { mandate: slug, proposal_id: row.id, number: row.number, title, change, snapshot_block: snapshotBlock.toString(), closes_at: row.closes_at });
  return { proposal_id: row.id, number: row.number, snapshot_block: snapshotBlock.toString(), closes_at: new Date(row.closes_at).toISOString(), holders_at_snapshot: Object.keys(snap.holders).length };
}

/**
 * Records a vote. Body: { voter, choice, signature } with the EIP-712 `Vote{mandate, proposalId, choice,
 * snapshotBlock}` signature. Weight = the voter's balance at the snapshot block. A later vote from the
 * same address replaces the earlier one until the vote closes.
 */
export async function submitVote(slug: string, pid: string, body: Record<string, unknown>) {
  const m = await mandateBySlug(slug);
  await closeDue(m.org_id);
  const [p] = await db()`SELECT id, state, closes_at, snapshot_block, holders FROM mandate_proposals WHERE id = ${pid}::uuid AND mandate_id = ${m.id}::uuid`;
  if (!p) throw new HttpError(404, "PS_REQUEST_001", "Proposal not found");
  if (p.state !== "open" || new Date(p.closes_at).getTime() <= Date.now()) throw new HttpError(409, "PS_REPLAY_001", "Voting on this proposal has closed");
  const choice = body.choice as VoteChoice;
  if (!(VOTE_CHOICES as readonly unknown[]).includes(choice)) throw new BadRequest("choice must be for, against or abstain");
  if (typeof body.voter !== "string" || !isAddress(body.voter)) throw new BadRequest("voter must be an address");
  if (typeof body.signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) throw new BadRequest("signature must be a 65-byte hex signature");
  let signer: string;
  try {
    signer = await recoverTypedDataAddress({ ...voteTypedData(Number(m.chain_id), { mandate: slug, proposalId: pid, choice, snapshotBlock: BigInt(p.snapshot_block) }), signature: body.signature as Hex });
  } catch {
    throw new HttpError(401, "PS_AUTH_001", "The signature is not valid");
  }
  // A signature for another mandate, proposal, choice or snapshot recovers to some other address.
  if (signer.toLowerCase() !== body.voter.toLowerCase()) throw new HttpError(401, "PS_AUTH_001", "The signature does not match this voter, proposal, choice and snapshot block");
  const voter = body.voter.toLowerCase();
  const weight = BigInt((p.holders as Record<string, string>)[voter] ?? "0");
  if (weight === 0n) throw new HttpError(403, "PS_AUTH_001", "This address held no tokens at the snapshot block, so it has no voting power on this proposal");
  const [r] = await db()`
    INSERT INTO mandate_votes (proposal_id, voter, choice, signature, weight)
    SELECT ${pid}::uuid, ${voter}, ${choice}, ${body.signature}, ${weight.toString()}::numeric
    WHERE EXISTS (SELECT 1 FROM mandate_proposals WHERE id = ${pid}::uuid AND state = 'open' AND closes_at > now())
    ON CONFLICT (proposal_id, voter) DO UPDATE SET choice = EXCLUDED.choice, signature = EXCLUDED.signature, signed_at = now(), replaced = mandate_votes.replaced + 1
    RETURNING replaced`;
  if (!r) throw new HttpError(409, "PS_REPLAY_001", "Voting on this proposal has closed");
  return { proposal_id: pid, voter, choice, weight: weight.toString(), replaced_earlier_vote: Number(r.replaced) > 0 };
}

// ---------------------------------------------------------------- closing (lazy)

/**
 * Closes every proposal whose voting period has ended (one organization, or all): counts, then for a
 * passed proposal compiles and activates the policy version with the mandate as the actor. The claim
 * (state open -> closed) is one statement, so a proposal is closed once. Called by reads, votes, the
 * console and the health check: no scheduler.
 */
export async function closeDue(orgId: string | null): Promise<void> {
  const due = await db()`
    SELECT p.id FROM mandate_proposals p JOIN mandates m ON m.id = p.mandate_id
    WHERE p.state = 'open' AND p.closes_at <= now() AND (p.claimed_at IS NULL OR p.claimed_at < now() - interval '5 minutes')
      AND (${orgId}::uuid IS NULL OR m.org_id = ${orgId}::uuid) ORDER BY p.closes_at LIMIT 10`;
  for (const d of due) {
    try {
      await closeOne(d.id);
    } catch (e) {
      logEvent("error", "mandate.close_failed", { proposal_id: d.id, message: (e as Error).message.slice(0, 200) });
    }
  }
}

async function closeOne(pid: string) {
  // Claim first (one statement): only the caller that wins the claim counts and applies the result.
  // A claim left by a crash is retried after 5 minutes; until then nothing changes (fail closed).
  const [won] = await db()`
    UPDATE mandate_proposals SET claimed_at = now()
    WHERE id = ${pid}::uuid AND state = 'open' AND closes_at <= now() AND (claimed_at IS NULL OR claimed_at < now() - interval '5 minutes')
    RETURNING id`;
  if (!won) return;
  const [p] = await db()`
    SELECT p.*, m.slug, m.org_id, m.policy_id, m.envelope, m.quorum, m.pass_bps FROM mandate_proposals p JOIN mandates m ON m.id = p.mandate_id
    WHERE p.id = ${pid}::uuid AND p.state = 'open' AND p.closes_at <= now()`;
  if (!p) return;
  const votes = await db()`SELECT voter, choice, weight::text AS weight FROM mandate_votes WHERE proposal_id = ${pid}::uuid ORDER BY voter`;
  const t = tally({ rules: { quorum: String(p.quorum), pass_bps: Number(p.pass_bps) }, votes: votes.map((v) => ({ voter: v.voter, choice: v.choice, weight: v.weight })) });
  const result: Record<string, unknown> = { ...t, voters: votes.length, counted_at: new Date().toISOString() };
  let state: "passed" | "rejected" | "failed" = t.passed ? "passed" : "rejected";
  let applied: { outcome: string; version?: number; pending_change_id?: string; effective_at?: string } | null = null;
  if (t.passed) {
    try {
      applied = await applyPassed(p.org_id, p.policy_id, p.change as MandateChange, p.envelope as MandateEnvelope, p.slug, Number(p.number));
    } catch (e) {
      state = "failed";
      result.failure = (e as Error).message.slice(0, 300);
    }
  }
  const [claimed] = await db()`
    UPDATE mandate_proposals SET state = ${state}, result = ${JSON.stringify(result)}::text::jsonb, closed_at = now(),
      policy_version = ${applied?.version ?? null}::int, applied = ${applied ? (applied.outcome === "pending" ? "pending" : "applied") : null},
      pending_change_id = ${applied?.pending_change_id ?? null}::uuid
    WHERE id = ${pid}::uuid AND state = 'open' RETURNING number`;
  if (!claimed) return;
  await db()`INSERT INTO audit_events (org_id, actor_user_id, type, detail) VALUES (${p.org_id}::uuid, NULL, 'mandate.closed', ${JSON.stringify({ mandate: p.slug, proposal: Number(p.number), state, result, applied })}::text::jsonb)`;
  afterChange(p.org_id, "mandate.vote_closed", { mandate: p.slug, proposal_id: pid, number: Number(p.number), state, result });
  if (applied) afterChange(p.org_id, "mandate.applied", { mandate: p.slug, proposal_id: pid, number: Number(p.number), outcome: applied.outcome, policy_version: applied.version ?? null, effective_at: applied.effective_at ?? null });
}

/** Compiles the passed change against the version that decides now and activates it (mandate as actor). */
async function applyPassed(orgId: string, policyId: string, change: MandateChange, envelope: MandateEnvelope, slug: string, number: number) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [pol] = await db()`
      SELECT p.active_version, p.draft, p.disabled_at, pv.document,
        coalesce((SELECT max(version) FROM policy_versions WHERE policy_id = p.id), 0) + 1 AS next
      FROM policies p LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version WHERE p.id = ${policyId}::uuid`;
    if (!pol?.document || pol.disabled_at) throw new Error("the mandate's policy has no active version");
    const compiled = compileProposal(pol.document as Policy, change, envelope);
    if (!compiled.ok) throw new Error(compiled.reason);
    const next = Number(pol.next);
    const document = { ...compiled.document, version: next, status: "active" } as Policy;
    const hash = await sha256Hex(canonicalJson(document));
    const cls = classifyPolicyChange(pol.document as Policy, document);
    const changes: PolicyChange[] = [{ path: "$.mandate", kind: cls.loosening ? "loosening" : "tightening", from: null, to: `${slug} #${number}`, note: `holder vote ${slug} #${number}` }, ...cls.changes];
    const [{ r }] = await db()`
      SELECT ps_activate_policy(${policyId}::uuid, ${orgId}::uuid, NULL, ${pol.active_version}::int, ${pol.draft === null ? null : JSON.stringify(pol.draft)}::text::jsonb,
        ${next}::int, ${JSON.stringify(document)}::text::jsonb, ${hash}, ${cls.loosening}, ${JSON.stringify(changes)}::text::jsonb, ${summarizeChanges(changes)}) AS r`;
    if (r.outcome === "conflict") continue;
    if (r.outcome === "pending")
      afterChange(orgId, "policy.loosening_pending", { pending_change_id: r.pending_change_id, kind: "policy_activation", policy_id: policyId, policy_version: next, summary: summarizeChanges(changes), diff: changes, effective_at: r.effective_at, mandate: slug });
    return { outcome: String(r.outcome), version: next, pending_change_id: (r.pending_change_id as string | undefined) ?? undefined, effective_at: r.effective_at ? new Date(String(r.effective_at)).toISOString() : undefined };
  }
  throw new Error("the policy changed while activating; nothing was applied");
}

// ---------------------------------------------------------------- public read

/** Everything the public page shows, from the database and the chain only. Nothing private. */
export async function publicMandate(slug: string) {
  const m = await mandateBySlug(slug);
  // Due delayed changes take effect before the page reads the active limits, then due votes close.
  await applyDue(m.org_id);
  await closeDue(m.org_id);
  const [ag] = await db()`
    SELECT a.account, a.status, o.emergency_stop, p.active_version, pv.document, pv.activated_at,
      (SELECT pc.resolved_at FROM pending_changes pc WHERE pc.policy_id = p.id AND pc.policy_version = p.active_version AND pc.state = 'applied' LIMIT 1) AS applied_at
    FROM agents a JOIN organizations o ON o.id = a.org_id JOIN policies p ON p.id = ${m.policy_id}::uuid
    LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version WHERE a.id = ${m.agent_id}::uuid`;
  const proposals = await db()`
    SELECT p.id, p.number, p.title, p.change, p.proposer, p.snapshot_block::text, p.opens_at, p.closes_at, p.state, p.result, p.policy_version, p.applied,
      pc.state AS pending_state, pc.effective_at AS pending_effective_at, pc.resolution AS pending_resolution, pc.resolved_at AS pending_resolved_at,
      (SELECT coalesce(json_agg(json_build_object('voter', v.voter, 'choice', v.choice, 'weight', v.weight::text) ORDER BY v.voter), '[]'::json) FROM mandate_votes v WHERE v.proposal_id = p.id) AS votes
    FROM mandate_proposals p LEFT JOIN pending_changes pc ON pc.id = p.pending_change_id WHERE p.mandate_id = ${m.id}::uuid ORDER BY p.number DESC LIMIT 20`;
  const decisions = await db()`
    SELECT id, decision, reason_code, transaction_hash, execution_success, created_at FROM operations
    WHERE agent_id = ${m.agent_id}::uuid ORDER BY created_at DESC LIMIT 15`;
  const doc = ag?.document as Policy | undefined;
  return {
    slug: m.slug,
    name: m.name,
    demo: m.demo,
    chain_id: Number(m.chain_id),
    token: { address: m.token, symbol: m.token_symbol },
    rules: { voting_period_seconds: Number(m.voting_period_seconds), quorum: String(m.quorum), pass_bps: Number(m.pass_bps), proposer_min: String(m.proposer_min) },
    smart_account: ag?.account ?? null,
    cosigner: palisecSigner(Number(m.chain_id))?.address ?? null,
    emergency_stop: Boolean(ag?.emergency_stop),
    envelope: m.envelope as MandateEnvelope,
    active: doc
      ? {
          version: Number(ag.active_version),
          since: new Date(ag.applied_at ?? ag.activated_at).toISOString(),
          max_transaction_value_wei: doc.limits.max_transaction_value_wei,
          hourly_budget_usd_micros: doc.limits.hourly_budget_usd_micros,
          approval_threshold_usd_micros: doc.human_approval.usd_threshold_micros,
          allowlist: doc.contracts.allowlist.map((e) => ({ address: e.address, selectors: e.selectors })),
          denylist: doc.contracts.denylist,
        }
      : null,
    proposals: proposals.map((p) => {
      const live = tally({ rules: { quorum: String(m.quorum), pass_bps: Number(m.pass_bps) }, votes: (p.votes as Row[]).map((v) => ({ voter: v.voter, choice: v.choice, weight: v.weight })) });
      return {
        id: p.id,
        number: Number(p.number),
        title: p.title,
        change: p.change,
        proposer: p.proposer,
        snapshot_block: p.snapshot_block,
        opens_at: new Date(p.opens_at).toISOString(),
        closes_at: new Date(p.closes_at).toISOString(),
        state: p.state,
        tally: p.state === "open" ? live : (p.result ?? live),
        votes: p.votes,
        policy_version: p.policy_version,
        applied: p.applied,
        pending: p.pending_state
          ? { state: p.pending_state, effective_at: new Date(p.pending_effective_at).toISOString(), resolution: p.pending_resolution, resolved_at: p.pending_resolved_at ? new Date(p.pending_resolved_at).toISOString() : null }
          : null,
      };
    }),
    decisions: decisions.map((d) => ({ id: d.id, decision: d.decision, reason_code: d.reason_code, transaction_hash: d.transaction_hash, executed: d.execution_success, at: new Date(d.created_at).toISOString() })),
    read_at: new Date().toISOString(),
  };
}

/** The full, self-contained vote file for one proposal: anyone can recount it. */
export async function voteFile(slug: string, pid: string) {
  const m = await mandateBySlug(slug);
  await closeDue(m.org_id);
  const [p] = await db()`SELECT * FROM mandate_proposals WHERE id = ${pid}::uuid AND mandate_id = ${m.id}::uuid`;
  if (!p) throw new HttpError(404, "PS_REQUEST_001", "Proposal not found");
  const votes = await db()`SELECT voter, choice, signature, weight::text AS weight, signed_at FROM mandate_votes WHERE proposal_id = ${pid}::uuid ORDER BY voter`;
  return {
    format: "palisec-mandate-vote-file/1",
    chain_id: Number(m.chain_id),
    token: { address: m.token, symbol: m.token_symbol, start_block: String(m.token_start_block) },
    mandate: { slug: m.slug, name: m.name, rules: { quorum: String(m.quorum), pass_bps: Number(m.pass_bps), proposer_min: String(m.proposer_min), voting_period_seconds: Number(m.voting_period_seconds) } },
    proposal: {
      id: p.id, number: Number(p.number), title: p.title, change: p.change, proposer: p.proposer, proposer_signature: p.proposer_signature,
      snapshot_block: String(p.snapshot_block), snapshot_total_supply: String(p.snapshot_total_supply), opens_at: new Date(p.opens_at).toISOString(), closes_at: new Date(p.closes_at).toISOString(),
      state: p.state, result: p.result, policy_version: p.policy_version, applied: p.applied,
    },
    votes: votes.map((v) => ({ voter: v.voter, choice: v.choice, signature: v.signature, weight: v.weight, signed_at: new Date(v.signed_at).toISOString() })),
    holders_at_snapshot: p.holders,
    signing: { eip712_domain: { name: "Palisec Mandates", version: "1", chainId: Number(m.chain_id) }, vote_type: "Vote(string mandate,string proposalId,uint8 choice,uint256 snapshotBlock)", choices: VOTE_CHOICES },
    recount: "node recount-mandate.mjs <this file> : verifies every signature, rebuilds the balances at the snapshot block from the token's Transfer logs and recomputes the result.",
  };
}


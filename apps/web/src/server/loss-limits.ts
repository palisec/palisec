import "server-only";
import { lossBreach, NATIVE_TOKEN, type LossSnapshot, type Policy } from "@palisec/policy-schema";
import { BaseError, createPublicClient, getAddress, InvalidParamsRpcError, parseAbi, parseAbiItem, toEventSelector, type Address } from "viem";
import { externalFlows, flowsUsd, peakNow, usdOf, type Movement } from "@/lib/loss-flows";
import { CHAINS, chainTransport, type ChainId } from "./config";
import { db, type Row } from "./db";
import { afterChange } from "./events";
import { logEvent } from "./http";
import { ASSETS, pricesFor } from "./valuation";

/*
 * Loss limits: the account's value before each decision (and hourly), recorded by Palisec
 * itself because the public RPC keeps no history. value = native ETH plus every priced asset
 * (valuation.ts) at Chainlink prices; flows = deposits minus withdrawals (lib/loss-flows.ts); the peak
 * is the highest value - flows in the window, at today's flows. The snapshot is an input to both engines.
 *
 * Fail closed: if a held or moved asset has no reliable price, or the chain cannot be read, the snapshot
 * has no value (the engines then return PS_LOSS_003 for anything that adds risk) and nothing is stored, so
 * the next snapshot scans from the last good one.
 */

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const CHUNK_BLOCKS = 400_000n;
const MAX_CHUNKS = 30;
const KEEP_DAYS = 8;
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SAFE_RECEIVED = toEventSelector("SafeReceived(address,uint256)");
const EXECUTED = new Set([
  toEventSelector("ExecutionSuccess(bytes32,uint256)"),
  toEventSelector("ExecutionFailure(bytes32,uint256)"),
  toEventSelector("ExecutionFromModuleSuccess(address)"),
  toEventSelector("ExecutionFromModuleFailure(address)"),
]);

export interface LossTarget {
  orgId: string;
  /** The policy row (uuid) measuring the account. State is per organization and account. */
  policyUuid: string;
  chainId: number;
  account: Address;
  policy: Policy;
}

export const lossLimitOn = (p: Policy | null): boolean => p?.loss_limit?.enabled === true;

const lower = (a: string) => a.toLowerCase();
/**
 * A failure reason safe to log and store: the first line only, with every URL removed (an RPC URL can
 * carry a provider key) and no request bodies.
 */
export const safeReason = (e: unknown): string =>
  (e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e))
    .split(/\r?\n/)[0]!
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/zk_[A-Za-z0-9_-]{8,}/g, "<key>")
    .slice(0, 200);

interface State {
  epoch: number;
  windowStartedAt: number;
  pausedCode: "PS_LOSS_001" | "PS_LOSS_002" | null;
}

/**
 * The account's latch state in this organization. A new reset_epoch of the same policy (the owner's reset,
 * applied after the loosening delay) clears the pause and restarts the window; that is announced as
 * loss_limit.reset. Another policy (the agent moved, or a copy of the policy) takes over the state as it
 * is: a pause and the window's peak carry over, so moving an agent never clears a breach.
 */
async function syncEpoch(t: LossTarget): Promise<State> {
  const epoch = t.policy.loss_limit!.reset_epoch;
  const account = lower(t.account);
  const [row] = await db()`
    WITH prev AS (SELECT policy_id, epoch FROM loss_limit_state WHERE org_id = ${t.orgId}::uuid AND chain_id = ${t.chainId} AND account = ${account})
    INSERT INTO loss_limit_state AS s (org_id, chain_id, account, policy_id, epoch) VALUES (${t.orgId}::uuid, ${t.chainId}, ${account}, ${t.policyUuid}::uuid, ${epoch})
    ON CONFLICT (org_id, chain_id, account) DO UPDATE SET
      policy_id = EXCLUDED.policy_id, epoch = EXCLUDED.epoch, updated_at = now(),
      window_started_at = CASE WHEN s.policy_id = EXCLUDED.policy_id THEN now() ELSE s.window_started_at END,
      paused_code = CASE WHEN s.policy_id = EXCLUDED.policy_id THEN NULL ELSE s.paused_code END,
      paused_at = CASE WHEN s.policy_id = EXCLUDED.policy_id THEN NULL ELSE s.paused_at END
      WHERE s.policy_id IS DISTINCT FROM EXCLUDED.policy_id OR s.epoch <> EXCLUDED.epoch
    RETURNING s.epoch, extract(epoch FROM s.window_started_at)::bigint AS started, s.paused_code,
      (SELECT epoch FROM prev) AS prev_epoch, ((SELECT policy_id FROM prev) = ${t.policyUuid}::uuid) AS same_policy`;
  if (row) {
    if (row.same_policy === true)
      afterChange(t.orgId, "loss_limit.reset", { chain_id: t.chainId, account, policy_id: t.policy.policy_id, reset_epoch: epoch });
    return { epoch: Number(row.epoch), windowStartedAt: Number(row.started), pausedCode: row.paused_code ?? null };
  }
  const [s] = await db()`
    SELECT epoch, extract(epoch FROM window_started_at)::bigint AS started, paused_code
    FROM loss_limit_state WHERE org_id = ${t.orgId}::uuid AND chain_id = ${t.chainId} AND account = ${account}`;
  return { epoch: Number(s!.epoch), windowStartedAt: Number(s!.started), pausedCode: s!.paused_code ?? null };
}

/** Sets the pause (once, until the owner resets) and announces it. Returns true when this call set it. */
export async function latch(t: LossTarget, code: "PS_LOSS_001" | "PS_LOSS_002", detail: Record<string, unknown>): Promise<boolean> {
  const account = lower(t.account);
  const rows = await db()`
    UPDATE loss_limit_state SET paused_code = ${code}, paused_at = now(), updated_at = now()
    WHERE org_id = ${t.orgId}::uuid AND chain_id = ${t.chainId} AND account = ${account} AND paused_code IS NULL
    RETURNING account`;
  if (!rows.length) return false;
  const l = t.policy.loss_limit!;
  afterChange(t.orgId, "loss_limit.triggered", {
    chain_id: t.chainId, account, reason_code: code, policy_id: t.policy.policy_id, policy_version: t.policy.version,
    max_drawdown_bps: l.max_drawdown_bps, max_loss_usd_micros: l.max_loss_usd_micros, window_seconds: l.window_seconds, ...detail,
  }, true);
  return true;
}

/**
 * Retries a log read that an RPC rejected as invalid. The fallback RPC can be a few seconds behind the one
 * that reported the latest block, and refuses a range that ends past its own head until it catches up.
 */
async function behindHeadRetry<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (e) {
      const invalid = e instanceof BaseError && e.walk((x) => x instanceof InvalidParamsRpcError) !== null;
      if (!invalid || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

/** Balance movements of the account's priced assets in (from, to], and the transactions the Safe executed. */
async function scanMoves(chainId: ChainId, account: Address, from: bigint, to: bigint, exits: Set<string>) {
  const c = createPublicClient({ transport: chainTransport(chainId, 10_000) });
  const tokens = ASSETS[chainId].filter((a) => a.contract !== NATIVE_TOKEN).map((a) => getAddress(a.contract));
  const moves: Movement[] = [];
  const executed = new Set<string>();
  let chunks = 0;
  for (let start = from; start <= to; start += CHUNK_BLOCKS) {
    if (++chunks > MAX_CHUNKS) throw new Error("account history since the last snapshot is too long to scan");
    const end = start + CHUNK_BLOCKS - 1n < to ? start + CHUNK_BLOCKS - 1n : to;
    const [own, out, inn] = await Promise.all([
      behindHeadRetry(() => c.getLogs({ address: account, fromBlock: start, toBlock: end })),
      tokens.length ? behindHeadRetry(() => c.getLogs({ address: tokens, event: TRANSFER, args: { from: account }, fromBlock: start, toBlock: end })) : [],
      tokens.length ? behindHeadRetry(() => c.getLogs({ address: tokens, event: TRANSFER, args: { to: account }, fromBlock: start, toBlock: end })) : [],
    ]);
    for (const l of own) {
      const topic = l.topics[0];
      if (!topic || !l.transactionHash) continue;
      if (EXECUTED.has(topic)) executed.add(lower(l.transactionHash));
      if (topic === SAFE_RECEIVED && l.topics[1])
        moves.push({ tx: lower(l.transactionHash), token: NATIVE_TOKEN, direction: "in", other: lower("0x" + l.topics[1].slice(26)), amount: BigInt(l.data) });
    }
    for (const l of out) if (l.transactionHash) moves.push({ tx: lower(l.transactionHash), token: lower(l.address), direction: "out", other: lower(l.args.to!), amount: l.args.value! });
    for (const l of inn) if (l.transactionHash) moves.push({ tx: lower(l.transactionHash), token: lower(l.address), direction: "in", other: lower(l.args.from!), amount: l.args.value! });
  }
  // ETH sent by the Safe is not in any log: Palisec's own record of the co-signed operation says where it went.
  if (executed.size && exits.size) {
    const rows = await db()`
      SELECT lower(transaction_hash) AS tx, lower(target) AS target, value_wei::text AS value FROM operations
      WHERE chain_id = ${chainId} AND lower(account) = ${lower(account)} AND lower(transaction_hash) = ANY(${[...executed]}::text[])
        AND execution_success IS TRUE AND data = '0x' AND value_wei > 0 AND lower(target) = ANY(${[...exits]}::text[])`;
    for (const r of rows) moves.push({ tx: r.tx, token: NATIVE_TOKEN, direction: "out", other: r.target, amount: BigInt(r.value) });
  }
  return { moves, executed };
}

/**
 * Measures the account now and returns the engines' input. Stores the snapshot when it has a value.
 * Never throws: a failure is an unavailable value (fail closed), with the reason logged and kept.
 * `record: false` (the policy editor's draft test) measures the value only: nothing is read from or
 * written to the account's history, the peak is today's value, and nothing can pause.
 */
export async function takeSnapshot(t: LossTarget, now: number, opts: { record?: boolean } = {}): Promise<LossSnapshot> {
  const record = opts.record !== false;
  const rules = t.policy.loss_limit!;
  const chainId = t.chainId as ChainId;
  const account = lower(t.account);
  let state: State | null = null;
  const unavailable = (reason: string, prices: LossSnapshot["prices"] = [], missing: string[] = []): LossSnapshot => {
    const why = safeReason(reason);
    logEvent("warn", "loss_limit.value_unavailable", { chain_id: chainId, account, why });
    if (record) db()`UPDATE loss_limit_state SET last_error = ${why.slice(0, 300)}, updated_at = now() WHERE org_id = ${t.orgId}::uuid AND chain_id = ${chainId} AND account = ${account}`.catch(() => {});
    return { observed_at: now, value_usd_micros: null, baseline_usd_micros: null, paused: state?.pausedCode ?? null, prices, unavailable: missing as `0x${string}`[] };
  };
  try {
    if (!CHAINS[chainId]?.enabled || !ASSETS[chainId]) return unavailable("chain not enabled");
    state = record ? await syncEpoch(t) : { epoch: rules.reset_epoch, windowStartedAt: now, pausedCode: null };
    const c = createPublicClient({ transport: chainTransport(chainId, 8000) });
    const [block, prices] = await Promise.all([c.getBlock({ blockTag: "latest" }), pricesFor(chainId, rules.max_closed_market_price_age_seconds)]);
    const assets = ASSETS[chainId];
    const tokens = assets.filter((a) => a.contract !== NATIVE_TOKEN);
    const [native, ...erc20] = await Promise.all([
      c.getBalance({ address: t.account, blockNumber: block.number }),
      ...(tokens.length
        ? [c.multicall({ multicallAddress: MULTICALL3, blockNumber: block.number, allowFailure: false, contracts: tokens.map((a) => ({ address: getAddress(a.contract), abi: ERC20, functionName: "balanceOf" as const, args: [t.account] as const })) })]
        : []),
    ]);
    const balances = new Map<string, bigint>([[NATIVE_TOKEN, native as bigint]]);
    tokens.forEach((a, i) => balances.set(a.contract, ((erc20[0] as bigint[] | undefined) ?? [])[i] ?? 0n));

    const ok = new Map<string, { price: bigint; decimals: number }>();
    const missing: string[] = [];
    for (const p of prices) {
      if (p.ok) ok.set(p.token, { price: p.price_micros, decimals: p.decimals });
      else missing.push(p.token);
    }
    const enginePrices = [...ok].map(([token, p]) => ({ token: token as `0x${string}`, price_micros: p.price.toString(), decimals: p.decimals }));
    const reasons = prices.filter((p) => !p.ok).map((p) => (p as { reason: string }).reason);

    let value = 0n;
    for (const [token, bal] of balances) {
      if (bal === 0n) continue;
      const p = ok.get(token);
      if (!p) return unavailable(`no reliable price for a held asset: ${reasons.join("; ") || token}`, enginePrices, missing);
      value += usdOf(bal, p.price, p.decimals);
    }

    if (!record) return { observed_at: now, value_usd_micros: value.toString(), baseline_usd_micros: value.toString(), paused: null, prices: enginePrices, unavailable: missing as `0x${string}`[] };

    // Flows since the last good snapshot in this window.
    const [prev] = await db()`
      SELECT block::text AS block, flows_usd_micros::text AS flows, extract(epoch FROM taken_at)::bigint AS at
      FROM loss_snapshots
      WHERE org_id = ${t.orgId}::uuid AND chain_id = ${chainId} AND account = ${account} AND taken_at >= to_timestamp(${state.windowStartedAt})
      ORDER BY block DESC, id DESC LIMIT 1`;
    let flows = 0n;
    if (prev && Number(prev.at) < now - rules.window_seconds) {
      // The last snapshot is older than the window, so no peak inside the window depends on it: start again.
      await db()`UPDATE loss_limit_state SET window_started_at = now(), updated_at = now() WHERE org_id = ${t.orgId}::uuid AND chain_id = ${chainId} AND account = ${account}`;
      state.windowStartedAt = now;
    } else if (prev) {
      const from = BigInt(prev.block) + 1n;
      flows = BigInt(prev.flows);
      if (from <= block.number) {
        const exits = new Set(rules.exit_addresses.map(lower));
        const { moves, executed } = await scanMoves(chainId, t.account, from, block.number, exits);
        const delta = flowsUsd(externalFlows(moves, executed, exits), ok, new Set(assets.map((a) => a.contract)));
        if (delta === null) return unavailable(`no reliable price for a deposited or withdrawn asset: ${reasons.join("; ")}`, enginePrices, missing);
        flows += delta;
      }
    }

    await db()`
      INSERT INTO loss_snapshots (org_id, chain_id, account, epoch, block, value_usd_micros, flows_usd_micros, balances, prices)
      VALUES (${t.orgId}::uuid, ${chainId}, ${account}, ${state.epoch}, ${block.number.toString()}::bigint, ${value.toString()}::numeric, ${flows.toString()}::numeric,
        ${JSON.stringify(Object.fromEntries([...balances].map(([k, v]) => [k, v.toString()])))}::text::jsonb, ${JSON.stringify(enginePrices)}::text::jsonb)`;
    const window = await db()`
      SELECT value_usd_micros::text AS value, flows_usd_micros::text AS flows FROM loss_snapshots
      WHERE org_id = ${t.orgId}::uuid AND chain_id = ${chainId} AND account = ${account}
        AND taken_at >= greatest(now() - make_interval(secs => ${rules.window_seconds}::int), to_timestamp(${state.windowStartedAt}))`;
    const peak = peakNow(window.map((r: Row) => ({ value: BigInt(r.value), flows: BigInt(r.flows) })), { value, flows });
    db()`UPDATE loss_limit_state SET last_error = NULL WHERE org_id = ${t.orgId}::uuid AND chain_id = ${chainId} AND account = ${account} AND last_error IS NOT NULL`.catch(() => {});

    let paused = state.pausedCode;
    const breach = paused ? null : lossBreach(rules, peak, value);
    if (breach && (await latch(t, breach, { peak_usd_micros: peak.toString(), value_usd_micros: value.toString(), source: "snapshot" }))) paused = breach;
    return { observed_at: now, value_usd_micros: value.toString(), baseline_usd_micros: peak.toString(), paused, prices: enginePrices, unavailable: missing as `0x${string}`[] };
  } catch (e) {
    return unavailable(safeReason(e));
  }
}

/** The latest recorded state for the console and the API (no chain reads). */
export async function lossStatus(orgId: string, agentId: string) {
  const [r] = await db()`
    SELECT a.chain_id, a.account, a.policy_id, pv.document,
      s.epoch, s.policy_id AS state_policy, s.paused_code, s.paused_at, s.window_started_at, s.last_error,
      (SELECT json_build_object('value', ls.value_usd_micros::text, 'flows', ls.flows_usd_micros::text, 'at', ls.taken_at, 'block', ls.block::text)
        FROM loss_snapshots ls WHERE ls.org_id = a.org_id AND ls.chain_id = a.chain_id AND ls.account = lower(a.account) AND ls.taken_at >= s.window_started_at
        ORDER BY ls.taken_at DESC, ls.id DESC LIMIT 1) AS last,
      (SELECT coalesce(json_agg(json_build_object('value', ls.value_usd_micros::text, 'flows', ls.flows_usd_micros::text)), '[]'::json)
        FROM loss_snapshots ls WHERE ls.org_id = a.org_id AND ls.chain_id = a.chain_id AND ls.account = lower(a.account)
          AND ls.taken_at >= greatest(now() - make_interval(secs => coalesce((pv.document->'loss_limit'->>'window_seconds')::int, 86400)), s.window_started_at)) AS window,
      (SELECT json_build_object('id', pc.id, 'effective_at', pc.effective_at) FROM pending_changes pc
        WHERE pc.org_id = a.org_id AND pc.policy_id = a.policy_id AND pc.state = 'pending'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(pc.diff) d WHERE d->>'path' = '$.loss_limit.reset_epoch')
        ORDER BY pc.effective_at LIMIT 1) AS reset_pending
    FROM agents a
    LEFT JOIN policies p ON p.id = a.policy_id AND p.disabled_at IS NULL
    LEFT JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    LEFT JOIN loss_limit_state s ON s.org_id = a.org_id AND s.chain_id = a.chain_id AND s.account = lower(a.account)
    WHERE a.id = ${agentId}::uuid AND a.org_id = ${orgId}::uuid`;
  if (!r) return null;
  const policy = r.document as Policy | null;
  const rules = policy?.loss_limit;
  if (!rules?.enabled) return { enabled: false as const };
  const last = r.last as { value: string; flows: string; at: string; block: string } | null;
  let peak: bigint | null = null;
  let loss: bigint | null = null;
  let drawdown: number | null = null;
  if (last) {
    const cur = { value: BigInt(last.value), flows: BigInt(last.flows) };
    peak = peakNow((r.window as { value: string; flows: string }[]).map((w) => ({ value: BigInt(w.value), flows: BigInt(w.flows) })), cur);
    loss = peak > cur.value ? peak - cur.value : 0n;
    drawdown = peak === 0n ? 0 : Number((loss * 10000n) / peak);
  }
  return {
    enabled: true as const,
    chain_id: Number(r.chain_id),
    account: r.account as string,
    limits: { max_drawdown_bps: rules.max_drawdown_bps, max_loss_usd_micros: rules.max_loss_usd_micros, window_seconds: rules.window_seconds, on_breach: rules.on_breach },
    reset_epoch: rules.reset_epoch,
    value_usd_micros: last?.value ?? null,
    peak_usd_micros: peak?.toString() ?? null,
    loss_usd_micros: loss?.toString() ?? null,
    drawdown_bps: drawdown,
    measured_at: last ? new Date(last.at).toISOString() : null,
    // A reset of this policy that has applied but not been seen by a snapshot yet already counts: the next decision clears it.
    paused: r.state_policy === r.policy_id && r.epoch !== null && Number(r.epoch) !== rules.reset_epoch ? null : (r.paused_code ?? null),
    paused_at: r.paused_at ? new Date(r.paused_at).toISOString() : null,
    window_started_at: r.window_started_at ? new Date(r.window_started_at).toISOString() : null,
    value_unavailable: r.last_error ? true : false,
    // Already reduced by safeReason (first line, no URLs) when stored; shown to the organization's members only.
    value_unavailable_reason: (r.last_error as string | null) ?? null,
    reset_pending: r.reset_pending ? { pending_change_id: r.reset_pending.id as string, effective_at: new Date(r.reset_pending.effective_at).toISOString() } : null,
  };
}

/**
 * Hourly: a snapshot of every account with a loss limit on (peaks and breaches between trades are
 * recorded; the webhook and banner stay current), then old snapshots are deleted. Returns counts only:
 * the scheduled job's log is public.
 */
export async function runLossKeeper(): Promise<{ accounts: number; measured: number; unavailable: number; paused: number }> {
  const { applyDue } = await import("./pending");
  await applyDue(null).catch(() => {});
  const rows = await db()`
    SELECT DISTINCT ON (a.org_id, a.chain_id, lower(a.account)) a.org_id, a.policy_id, a.chain_id, a.account, pv.document
    FROM agents a JOIN policies p ON p.id = a.policy_id AND p.disabled_at IS NULL
    JOIN policy_versions pv ON pv.policy_id = p.id AND pv.version = p.active_version
    WHERE a.status <> 'revoked' AND (pv.document->'loss_limit'->>'enabled') = 'true'
    ORDER BY a.org_id, a.chain_id, lower(a.account), a.created_at DESC`;
  const now = Math.floor(Date.now() / 1000);
  let measured = 0, unavailable = 0, paused = 0;
  for (const r of rows) {
    const s = await takeSnapshot({ orgId: r.org_id, policyUuid: r.policy_id, chainId: Number(r.chain_id), account: getAddress(r.account) as Address, policy: r.document as Policy }, now);
    if (s.value_usd_micros === null) unavailable++;
    else measured++;
    if (s.paused) paused++;
  }
  await db()`DELETE FROM loss_snapshots WHERE taken_at < now() - make_interval(days => ${KEEP_DAYS}::int)`;
  return { accounts: rows.length, measured, unavailable, paused };
}


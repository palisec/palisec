import "server-only";
import { NATIVE_TOKEN, type AssetAmount, type AssetIntent, type AssetSimulation } from "@palisec/policy-schema";
import { decodeAbiParameters, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { CHAINS, type ChainId } from "./config";
import { BadRequest, logEvent } from "./http";
import { SELL_PROBE_CODE } from "./sell-probe";

/*
 * Asset safety: what an operation actually does to the account's assets, measured on current
 * chain state with eth_simulateV1 (the chain's own RPC; no third party). The result is an input to both
 * policy engines, like price and fee; the engines apply the rules. Nothing is cached: every decision
 * simulates afresh, and a failure returns null, which the engines treat as unavailable (fail closed).
 *
 *  1. The exact operation, from the account, at the latest block: revert or success, and every ERC-20
 *     and ETH transfer and approval (traceTransfers) -> net outflows, inflows and approvals.
 *  2. Only if tokens were received: the same block again, then a second block in which the SellProbe
 *     code is placed at the account (state override) and sends each received token back to the pool it
 *     came from. A blocked transfer is a honeypot; a shortfall is a transfer tax; a Uniswap-V2-style
 *     pool also completes the sell, which gives the round-trip loss.
 */

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const APPROVAL = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const TIMEOUT_MS = 2500;
const PROBE_GAS = 1_500_000;
const MAX_PROBES = 3;
const PROBE_ABI = [
  {
    type: "function",
    name: "probe",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "pool", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      {
        name: "r",
        type: "tuple",
        components: [
          { name: "transferred", type: "bool" },
          { name: "poolReceived", type: "uint256" },
          { name: "outToken", type: "address" },
          { name: "outAmount", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const hex = (n: bigint | number) => `0x${BigInt(n).toString(16)}`;
const word = (a: string) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const ALLOWANCE = "0xdd62ed3e"; // allowance(address owner, address spender)
const topicAddress = (t: string) => `0x${t.slice(26)}`.toLowerCase();

export interface SimulationInput {
  chainId: number;
  account: Address;
  to: Address;
  valueWei: bigint;
  data: Hex;
  gasLimit: number;
}

interface RpcLog {
  address: string;
  topics: string[];
  data: string;
}
interface RpcCall {
  status: string;
  returnData: string;
  logs?: RpcLog[];
  error?: unknown;
}
interface RpcBlock {
  number: string;
  timestamp: string;
  calls: RpcCall[];
}

/** Simulation can be switched off (PALISEC_SIMULATION=off): asset-safety policies then deny or hold. */
export const simulationEnabled = () => process.env.PALISEC_SIMULATION !== "off";

/**
 * eth_simulateV1 on the chain's RPCs in order (a configured provider first, then the public endpoint).
 * A rate limit or server error moves to the next RPC; the last one gets one short retry. All attempts
 * share one deadline, so a slow chain makes the decision fail closed instead of hanging.
 */
async function simulateV1(chainId: number, blocks: unknown[]): Promise<RpcBlock[]> {
  const urls = CHAINS[chainId as ChainId]?.rpcs ?? [];
  if (urls.length === 0) throw new Error("no RPC for chain");
  const deadline = Date.now() + TIMEOUT_MS;
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_simulateV1", params: [{ blockStateCalls: blocks, traceTransfers: true, validation: false }, "latest"] });
  const attempts = [...urls, urls[urls.length - 1]!];
  let last = "no attempt";
  for (let i = 0; i < attempts.length; i++) {
    const left = deadline - Date.now();
    if (left < 150) break;
    if (i === attempts.length - 1) await new Promise((r) => setTimeout(r, Math.min(250, left / 3)));
    try {
      const res = await fetch(attempts[i]!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(Math.max(100, deadline - Date.now())),
        cache: "no-store",
      });
      if (!res.ok) {
        last = `RPC HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { result?: RpcBlock[]; error?: { message?: string } };
      if (Array.isArray(json.result)) return json.result;
      last = `eth_simulateV1: ${json.error?.message ?? "no result"}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(last);
}

/** Net per-token movement of the account, approvals it granted, and where received tokens came from. */
function analyse(account: string, logs: RpcLog[]) {
  const net = new Map<string, bigint>();
  const approvals: AssetSimulation["approvals"] = [];
  const transfersOut: NonNullable<AssetSimulation["transfers_out"]> = [];
  const sources = new Map<string, Map<string, bigint>>(); // token -> sender -> amount sent to the account
  const sentBy = new Map<string, bigint>(); // `${token}|${sender}` -> everything that sender moved of the token
  for (const l of logs) {
    if (l.topics.length !== 3 || l.data.length !== 66) continue; // ERC-20 (and traced ETH) only, not ERC-721
    const token = l.address.toLowerCase();
    const a = topicAddress(l.topics[1]!);
    const b = topicAddress(l.topics[2]!);
    const amount = BigInt(l.data);
    if (l.topics[0] === TRANSFER) {
      sentBy.set(`${token}|${a}`, (sentBy.get(`${token}|${a}`) ?? 0n) + amount);
      if (a === account) {
        net.set(token, (net.get(token) ?? 0n) - amount);
        if (token !== NATIVE_TOKEN) transfersOut.push({ token: token as Address, to: b as Address, amount: amount.toString() });
      }
      if (b === account) {
        net.set(token, (net.get(token) ?? 0n) + amount);
        const m = sources.get(token) ?? new Map<string, bigint>();
        m.set(a, (m.get(a) ?? 0n) + amount);
        sources.set(token, m);
      }
    } else if (l.topics[0] === APPROVAL && a === account && token !== NATIVE_TOKEN) {
      approvals.push({ token: token as Address, spender: b as Address, amount: amount.toString() });
    }
  }
  const outflows: AssetAmount[] = [];
  const inflows: AssetAmount[] = [];
  for (const [token, d] of net) {
    if (d < 0n) outflows.push({ token: token as Address, amount: (-d).toString() });
    if (d > 0n) inflows.push({ token: token as Address, amount: d.toString() });
  }
  return { outflows, inflows, approvals, transfersOut, sources, sentBy };
}

const bps = (part: bigint, whole: bigint) => (whole <= 0n ? 0 : Number(((part < 0n ? 0n : part) * 10_000n) / whole));
const clampBps = (n: number) => Math.max(0, Math.min(10_000, n));

/**
 * Simulates the operation and its sell leg. Returns null when anything needed is unavailable; the
 * engines then deny (or hold for a human, if the policy says so). `ms` is the time it took.
 */
export async function simulateOperation(input: SimulationInput): Promise<{ sim: AssetSimulation | null; ms: number; error?: string }> {
  const started = Date.now();
  if (!simulationEnabled()) return { sim: null, ms: 0, error: "simulation switched off" };
  const account = input.account.toLowerCase();
  // No gas cap: execution through the smart account is gas-estimated by the bundler, not by the agent's
  // gas_limit (which only bounds the fee check), so the simulation measures what the call itself does.
  const main = { from: input.account, to: input.to, value: hex(input.valueWei), data: input.data };
  try {
    const first = await simulateV1(input.chainId, [{ calls: [main] }]);
    const block = first[0]!;
    const call = block.calls[0]!;
    const reverted = call.status !== "0x1";
    const a = analyse(account, reverted ? [] : (call.logs ?? []));
    const received = a.inflows.filter((t) => t.token !== NATIVE_TOKEN).slice(0, MAX_PROBES);
    let sell: AssetSimulation["sell"] = null;
    let tax: number | null = null;
    let loss: number | null = null;
    let at = block;
    if (!reverted && received.length > 0) {
      // The pool each token came from: the sender of the largest transfer of it into the account.
      const probes = received.map((t) => {
        const from = [...(a.sources.get(t.token)!.entries())].sort((x, y) => (y[1] > x[1] ? 1 : y[1] < x[1] ? -1 : 0))[0]![0];
        return { token: t.token, pool: from, amount: BigInt(t.amount) };
      });
      const second = await simulateV1(input.chainId, [
        { calls: [main] },
        {
          stateOverrides: { [input.account]: { code: SELL_PROBE_CODE } },
          calls: probes.map((p) => ({
            from: input.account,
            to: input.account,
            gas: hex(PROBE_GAS),
            data: encodeFunctionData({ abi: PROBE_ABI, functionName: "probe", args: [getAddress(p.token), getAddress(p.pool), p.amount] }),
          })),
        },
      ]);
      at = second[0]!;
      if (second[0]!.calls[0]!.status !== "0x1") throw new Error("operation result changed between simulations");
      const results = second[1]!.calls;
      if (results.length !== probes.length || results.some((r) => r.status !== "0x1")) {
        // The probe never reverts by design; if it did, the sell leg is unknown (not proven unsafe).
        sell = null;
      } else {
        let blocked = false;
        let worst = 0;
        probes.forEach((p, i) => {
          const [r] = decodeAbiParameters(PROBE_ABI[0].outputs, results[i]!.returnData as Hex);
          if (!r.transferred) {
            blocked = true;
            return;
          }
          // Buy leg: what the pool sent in total versus what reached the account. Sell leg: what the pool got.
          const sentByPool = a.sentBy.get(`${p.token}|${p.pool}`) ?? 0n;
          worst = Math.max(worst, bps(sentByPool - p.amount, sentByPool), bps(p.amount - r.poolReceived, p.amount));
          const spent = a.outflows.find((o) => o.token === r.outToken.toLowerCase());
          if (loss === null && r.outAmount > 0n && spent) loss = clampBps(bps(BigInt(spent.amount) - r.outAmount, BigInt(spent.amount)));
        });
        sell = { reverted: blocked };
        tax = blocked ? null : clampBps(worst);
      }
    }
    // What the operation leaves newly approved, per spender it approved: the allowance read right after it,
    // less the allowance right before it, in the same simulated block. So the token spend rule counts an
    // approval that stays open, but not one a router pulled within the call, and not an older allowance a
    // swap merely uses up (some tokens emit Approval on every transferFrom). Unavailable: left out, and the
    // engines count the approved amounts instead.
    let allowancesAfter: AssetSimulation["allowances_after"];
    const pairs = [...new Map(a.approvals.map((x) => [`${x.token}|${x.spender}`, x])).values()];
    if (!reverted && pairs.length > 0 && pairs.length <= 8) {
      try {
        const reads = pairs.map((x) => ({ from: input.account, to: x.token, data: `${ALLOWANCE}${word(account)}${word(x.spender)}` }));
        const third = await simulateV1(input.chainId, [{ calls: [...reads, main, ...reads] }]);
        const calls = third[0]!.calls;
        const n = pairs.length;
        // The operation must do exactly what it did in the first run (same logs), or the read is not used.
        const effect = (logs: RpcLog[] | undefined) => JSON.stringify((logs ?? []).map((l) => [l.address.toLowerCase(), l.topics, l.data]));
        const same = effect(calls[n]?.logs) === effect(call.logs);
        const ok = same && calls.length === 2 * n + 1 && calls[n]!.status === "0x1" && [...calls.slice(0, n), ...calls.slice(n + 1)].every((c) => c.status === "0x1" && c.returnData.length === 66);
        if (ok)
          allowancesAfter = pairs.map((x, i) => {
            const before = BigInt(calls[i]!.returnData);
            const after = BigInt(calls[n + 1 + i]!.returnData);
            return { token: x.token, spender: x.spender, amount: (after > before ? after - before : 0n).toString() };
          });
      } catch {
        allowancesAfter = undefined;
      }
    }
    // eth_simulateV1 runs on the latest block's state in a virtual next block (stamped ~12 s ahead), so
    // report the state's block and the moment the simulation answered.
    const sim: AssetSimulation = {
      block_number: Number(BigInt(at.number)) - 1,
      observed_at: Math.floor(Date.now() / 1000),
      reverted,
      outflows: a.outflows,
      inflows: a.inflows,
      approvals: a.approvals,
      transfers_out: a.transfersOut,
      ...(allowancesAfter ? { allowances_after: allowancesAfter } : {}),
      sell,
      tax_bps: tax,
      round_trip_loss_bps: loss,
    };
    return { sim, ms: Date.now() - started };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logEvent("warn", "asset_sim.unavailable", { chain_id: input.chainId, message: error.slice(0, 200) });
    return { sim: null, ms: Date.now() - started, error };
  }
}

// ---------------------------------------------------------------- declared intent

const UINT = /^(0|[1-9][0-9]{0,77})$/;
const MAX_ENTRIES = 8;

function amounts(v: unknown, field: string): AssetAmount[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_ENTRIES) throw new BadRequest(`asset_intent.${field} must be an array of at most ${MAX_ENTRIES} entries`);
  return v.map((e, i) => {
    const o = e as Record<string, unknown>;
    if (!o || typeof o !== "object" || Object.keys(o).some((k) => k !== "token" && k !== "amount"))
      throw new BadRequest(`asset_intent.${field}[${i}] must be {token, amount}`);
    if (typeof o.token !== "string" || !isAddress(o.token, { strict: false })) throw new BadRequest(`asset_intent.${field}[${i}].token must be an address (0xEeee…EEeE for ETH)`);
    if (typeof o.amount !== "string" || !UINT.test(o.amount)) throw new BadRequest(`asset_intent.${field}[${i}].amount must be a non-negative integer string`);
    return { token: o.token.toLowerCase() as Address, amount: o.amount };
  });
}

/** Validates the optional `asset_intent` of a request body: {spend: [{token, amount}], receive: [...]}. */
export function parseAssetIntent(v: unknown): AssetIntent | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw new BadRequest("asset_intent must be an object");
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "spend" && k !== "receive") throw new BadRequest(`Unknown field: asset_intent.${k}`);
  return { spend: amounts(o.spend, "spend"), receive: amounts(o.receive, "receive") };
}

/**
 * What the request plainly declares on its own, merged with what the agent declared: the ETH value it
 * sends, and the amount of an ERC-20 `transfer(to, amount)`. Approvals are never inferred, so an
 * approval to a contract that is not on the allowlist must be declared explicitly.
 */
export function declaredIntent(explicit: AssetIntent | null, to: Address, valueWei: string, data: Hex): AssetIntent {
  const spend = new Map<string, bigint>();
  for (const s of explicit?.spend ?? []) spend.set(s.token, (spend.get(s.token) ?? 0n) + BigInt(s.amount));
  const add = (token: string, amount: bigint) => {
    if (amount > 0n && !explicit?.spend.some((s) => s.token === token)) spend.set(token, (spend.get(token) ?? 0n) + amount);
  };
  add(NATIVE_TOKEN, BigInt(valueWei));
  if (data.length === 2 + 8 + 128 && data.slice(0, 10).toLowerCase() === "0xa9059cbb") add(to.toLowerCase(), BigInt(`0x${data.slice(74)}`));
  return {
    spend: [...spend].map(([token, amount]) => ({ token: token as Address, amount: amount.toString() })),
    receive: explicit?.receive ?? [],
  };
}

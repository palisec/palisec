/**
 * Seeded generators for parity testing. The same seed always yields the same case, so fixtures
 * can be regenerated and checked, and a failing fuzz case can be reproduced from its seed.
 */
import { EXAMPLE_POLICY, fingerprint, selectorOf, validatePolicy } from "@palisec/policy-schema";

export type Rng = () => number;

/** mulberry32 */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const chance = (r: Rng, p: number) => r() < p;
const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const digits = (r: Rng, n: number) => String(int(r, 1, 9)) + Array.from({ length: n - 1 }, () => int(r, 0, 9)).join("");
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const POOL = [
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01",
  "0xabcdef0123456789abcdef0123456789abcdef01",
  "0x5555555555555555555555555555555555555555",
];
const SELECTORS = ["0xa9059cbb", "0x095ea7b3", "0x38ed1739", "0xA9059CBB", "0xdeadbeef"];
const AGENTS = ["agent-a", "agent-b", "ägent-ü-😀", "agent with spaces"];
const REQUESTS = ["req-1", "req-2", "req-3", "req-😀", "r"];
const NOW = 1_800_000_000;

const uintish = (r: Rng) =>
  pick(r, [
    "0",
    "1",
    digits(r, int(r, 1, 6)),
    digits(r, int(r, 12, 20)),
    "1000000000000000000",
    digits(r, 78),
  ]);

function calldata(r: Rng): string {
  const sel = pick(r, SELECTORS);
  return pick(r, [
    "0x",
    "0x",
    sel + "00".repeat(int(r, 0, 64)),
    sel.toLowerCase() + "ab".repeat(32),
    "0xabc",
    "0x12",
    "0x" + "ff".repeat(int(r, 4, 9)),
    "nothex",
  ]);
}

export interface EvalCase {
  policy: unknown;
  intent: Record<string, unknown>;
  state: Record<string, unknown>;
  env: Record<string, unknown>;
}

function policyFor(r: Rng): unknown {
  if (chance(r, 0.04)) return null;
  const p = clone(EXAMPLE_POLICY) as unknown as Record<string, any>;
  p.account.chain_id = pick(r, [46630, 46630, 4663]);
  p.account.address = pick(r, [ACCOUNT, ACCOUNT.toUpperCase().replace("0X", "0x"), POOL[0]!]);
  p.status = pick(r, ["active", "active", "active", "active", "draft", "disabled"]);
  p.version = int(r, 1, 50);
  p.limits = {
    max_transaction_value_wei: uintish(r),
    max_gas_cost_wei: uintish(r),
    hourly_budget_usd_micros: uintish(r),
    max_pending_operations: int(r, 0, 5),
    max_price_age_seconds: int(r, 1, 600),
  };
  p.cooldowns = { identical_calldata_seconds: pick(r, [0, 30, 600]), identical_intent_seconds: pick(r, [0, 15, 900]) };
  p.contracts.allowlist = Array.from({ length: int(r, 0, 4) }, () => ({
    address: pick(r, POOL),
    selectors: Array.from({ length: int(r, 0, 3) }, () => pick(r, SELECTORS)),
    require_verified_code: chance(r, 0.4),
  }));
  p.contracts.denylist = POOL.filter(() => chance(r, 0.15));
  p.human_approval = { usd_threshold_micros: uintish(r), require_for_unknown_methods: chance(r, 0.5) };
  if (chance(r, 0.06)) return mutatePolicy(r, p, int(r, 1, 3));
  return p;
}

export function evalCase(seed: number): EvalCase {
  const r = rng(seed);
  const policy = policyFor(r);
  const now = NOW + int(r, 0, 10_000);
  const to = chance(r, 0.95) ? pick(r, POOL) : pick(r, ["0x12", "0xZZ22222222222222222222222222222222222222"]);
  const data = calldata(r);
  const agent = pick(r, AGENTS);
  const value = chance(r, 0.9) ? uintish(r) : pick(r, ["01", "-1", "1.5", ""]);
  const intent: Record<string, unknown> = {
    request_id: chance(r, 0.03) ? "" : pick(r, REQUESTS),
    agent_id: agent,
    chain_id: pick(r, [46630, 46630, 46630, 4663]),
    from: chance(r, 0.9) ? pick(r, [ACCOUNT, "0x1111111111111111111111111111111111111111"]) : pick(r, [POOL[1]!, "0x11"]),
    to,
    value_wei: value,
    data,
    deadline: now + int(r, -30, 400),
  };
  const verified: Record<string, boolean> = {};
  for (const a of POOL) if (chance(r, 0.6)) verified[a.toLowerCase()] = chance(r, 0.85);
  const env: Record<string, unknown> = {
    now,
    fee_estimate_wei: chance(r, 0.08) ? null : chance(r, 0.03) ? "abc" : uintish(r),
    eth_usd: chance(r, 0.08) ? null : { price_micros: pick(r, ["0", "3200000000", digits(r, int(r, 7, 12))]), observed_at: now - int(r, 0, 900) },
    verified_code: verified,
    emergency_stop: chance(r, 0.04),
    paused_agents: chance(r, 0.05) ? [agent] : chance(r, 0.1) ? ["someone-else"] : [],
  };
  // Four in ten cases start coherent (everything lines up for ALLOW or review), then take at most
  // one perturbation, so every check is reached and every outcome occurs.
  if (policy && typeof policy === "object" && !Array.isArray(policy) && chance(r, 0.4)) {
    const p = policy as Record<string, any>;
    if (validatePolicy(p).length === 0) {
      p.status = "active";
      p.account = { chain_id: 46630, address: ACCOUNT };
      intent.chain_id = 46630;
      intent.from = ACCOUNT;
      if (!/^0x[0-9a-fA-F]{40}$/.test(intent.to as string)) intent.to = POOL[0]!;
      if (!/^(0|[1-9][0-9]{0,77})$/.test(intent.value_wei as string)) intent.value_wei = "1000";
      if (!/^0x([0-9a-fA-F]{2})*$/.test(intent.data as string)) intent.data = "0x";
      if (!intent.request_id) intent.request_id = "req-ok";
      intent.deadline = now + 120;
      const sel = selectorOf(intent.data as string);
      const target = (intent.to as string).toLowerCase();
      p.contracts.denylist = p.contracts.denylist.filter((a: string) => a.toLowerCase() !== target);
      p.contracts.allowlist = p.contracts.allowlist.filter((e: { address: string }) => e.address.toLowerCase() !== target);
      p.contracts.allowlist.push({ address: intent.to, selectors: sel && chance(r, 0.8) ? [sel] : [], require_verified_code: chance(r, 0.5) });
      p.limits.max_transaction_value_wei = "9".repeat(78);
      p.limits.max_gas_cost_wei = "9".repeat(30);
      p.limits.hourly_budget_usd_micros = chance(r, 0.8) ? "9".repeat(40) : p.limits.hourly_budget_usd_micros;
      p.limits.max_pending_operations = int(r, 3, 8);
      p.limits.max_price_age_seconds = 600;
      p.cooldowns = { identical_calldata_seconds: chance(r, 0.8) ? 0 : 600, identical_intent_seconds: chance(r, 0.8) ? 0 : 900 };
      p.human_approval.usd_threshold_micros = chance(r, 0.7) ? "9".repeat(60) : pick(r, ["0", "1", "5000000"]);
      Object.assign(env, {
        fee_estimate_wei: chance(r, 0.9) ? String(int(r, 0, 10 ** 9)) : env.fee_estimate_wei,
        eth_usd: chance(r, 0.9) ? { price_micros: "3200000000", observed_at: now - int(r, 0, 300) } : env.eth_usd,
        emergency_stop: chance(r, 0.03),
        paused_agents: [],
      });
      (env.verified_code as Record<string, boolean>)[target] = chance(r, 0.9);
    }
  }
  const calldataKey = fingerprint(`${(intent.to as string).toLowerCase()}|${(intent.data as string).toLowerCase()}`);
  const intentKey = fingerprint(`${agent}|${(intent.to as string).toLowerCase()}|${selectorOf(intent.data as string) ?? "native"}|${intent.value_wei as string}`);
  const state = {
    reservations: Array.from({ length: int(r, 0, 7) }, (_, i) => {
      const created = now - int(r, 0, 5000);
      return {
        reservation_id: `res_${i}`,
        request_id: `old-${i}`,
        agent_id: pick(r, AGENTS),
        policy_version: int(r, 1, 50),
        amount_usd_micros: pick(r, ["0", digits(r, int(r, 1, 10))]),
        created_at: created,
        expires_at: created + pick(r, [300, 60, 3600]),
        state: pick(r, ["reserved", "reserved", "pending_approval", "released", "finalized"]),
      };
    }),
    seen_request_ids: REQUESTS.filter(() => chance(r, 0.12)),
    calldata_seen: chance(r, 0.3) ? { [calldataKey]: now - int(r, 0, 700), "0xffffffffffffffff": now } : {},
    intent_seen: chance(r, 0.3) ? { [intentKey]: now - int(r, 0, 1000) } : {},
  };
  return { policy, intent, state, env };
}

/** Random structural damage to a policy document, for validation parity. */
export function mutatePolicy(r: Rng, doc: unknown, times: number): unknown {
  const d = clone(doc) as any;
  const junk = () =>
    pick(r, [
      null,
      true,
      0,
      -1,
      2.5,
      2147483648,
      "",
      "x",
      "01",
      "1.0",
      [],
      [1],
      {},
      { a: 1 },
      "0x1234",
      "0xa9059cbb",
      "1000000000000000000",
      "9".repeat(79),
      3600,
      86401,
      1001,
    ]);
  for (let n = 0; n < times; n++) {
    // Walk to a random container.
    let parent: any = d;
    let key: string | number | null = null;
    for (let depth = 0; depth < 4; depth++) {
      const v: any = key === null ? parent : parent?.[key];
      if (v === null || typeof v !== "object") break;
      const keys: (string | number)[] = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v);
      if (!keys.length || chance(r, 0.25)) break;
      if (key !== null) parent = v;
      key = pick(r, keys as (string | number)[]);
    }
    if (key === null || parent === null || typeof parent !== "object") continue;
    const action = int(r, 0, 3);
    if (action === 0 && !Array.isArray(parent)) delete parent[key];
    else if (action === 1 && !Array.isArray(parent)) parent[pick(r, ["extra", "10", "2", "01", "__proto_x", "Status"])] = junk();
    else parent[key] = junk();
  }
  return d;
}

export function validateCase(seed: number): unknown {
  const r = rng(seed ^ 0x5bd1e995);
  if (chance(r, 0.03)) return pick(r, [null, 5, "policy", [], [EXAMPLE_POLICY]]);
  return mutatePolicy(r, EXAMPLE_POLICY, int(r, 0, 5));
}

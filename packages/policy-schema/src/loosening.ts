import type { Policy } from "./types";

/**
 * Phase 6, loosening delay: classifies the difference between the version that decides today and a
 * proposed one. Every leaf difference is classified; anything not recognised is loosening, so a new
 * field or an odd edit can never slip through as "harmless". A change with any loosening part is
 * delayed as a whole; a change that only tightens applies at once.
 */

export type ChangeKind = "tightening" | "loosening";

export interface PolicyChange {
  path: string;
  kind: ChangeKind;
  from: unknown;
  to: unknown;
  note: string;
}

export interface Classification {
  changes: PolicyChange[];
  /** True when at least one change loosens (or cannot be classified safely). */
  loosening: boolean;
}

/** Set by activation, or descriptive only: never a change in what is allowed. */
const IGNORED = new Set(["$.version", "$.status", "$.schema_version", "$.policy_id"]);

const big = (v: unknown): bigint | null => (typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v) ? BigInt(v) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Higher value means looser (limits, budgets, ages, thresholds) or tighter (cooldowns). */
const NUMERIC: Record<string, { looserWhen: "higher" | "lower"; label: string }> = {
  "$.limits.max_transaction_value_wei": { looserWhen: "higher", label: "per-transaction limit" },
  "$.limits.max_gas_cost_wei": { looserWhen: "higher", label: "gas cost limit" },
  "$.limits.hourly_budget_usd_micros": { looserWhen: "higher", label: "hourly budget" },
  "$.limits.max_pending_operations": { looserWhen: "higher", label: "pending operation limit" },
  "$.limits.max_price_age_seconds": { looserWhen: "higher", label: "accepted price age" },
  "$.cooldowns.identical_calldata_seconds": { looserWhen: "lower", label: "identical-calldata cooldown" },
  "$.cooldowns.identical_intent_seconds": { looserWhen: "lower", label: "identical-intent cooldown" },
  "$.human_approval.usd_threshold_micros": { looserWhen: "higher", label: "human approval threshold" },
  "$.asset_safety.max_transfer_tax_bps": { looserWhen: "higher", label: "maximum transfer tax" },
  "$.asset_safety.max_slippage_bps": { looserWhen: "higher", label: "maximum slippage" },
  "$.asset_safety.max_simulation_age_seconds": { looserWhen: "higher", label: "accepted simulation age" },
  "$.upoch_recovery.max_checkpoint_age_seconds": { looserWhen: "higher", label: "accepted Upoch checkpoint age" },
};

/** Booleans: the value that is stricter. */
const STRICT_BOOL: Record<string, { strict: boolean; label: string }> = {
  "$.human_approval.require_for_unknown_methods": { strict: false, label: "unknown methods (false: deny, true: human review)" },
  "$.asset_safety.enabled": { strict: true, label: "asset safety" },
  "$.asset_safety.require_sell_simulation": { strict: true, label: "sell simulation" },
  "$.asset_safety.block_unlimited_approvals": { strict: true, label: "unlimited approval block" },
  "$.upoch_recovery.require_upoch_recoverable": { strict: true, label: "must be recoverable on Upoch" },
  "$.upoch_recovery.require_guardian": { strict: true, label: "Upoch guardian required" },
};

function numeric(path: string, from: unknown, to: unknown): PolicyChange {
  const rule = NUMERIC[path]!;
  const a = big(from) ?? (num(from) !== null ? BigInt(Math.trunc(num(from)!)) : null);
  const b = big(to) ?? (num(to) !== null ? BigInt(Math.trunc(num(to)!)) : null);
  if (a === null || b === null) return { path, kind: "loosening", from, to, note: `${rule.label} changed in a way that cannot be compared` };
  const higher = b > a;
  const looser = rule.looserWhen === "higher" ? higher : !higher;
  return { path, kind: looser ? "loosening" : "tightening", from, to, note: `${rule.label} ${higher ? "raised" : "lowered"}` };
}

type Entry = { address: string; selectors: string[]; require_verified_code: boolean };

function allowlist(before: unknown, after: unknown, out: PolicyChange[]) {
  const path = "$.contracts.allowlist";
  // The engines use the first entry for an address, so the first one is what counts here too.
  let duplicates = false;
  const index = (list: unknown) => {
    const m = new Map<string, Entry>();
    if (Array.isArray(list))
      for (const e of list as Entry[])
        if (e && typeof e.address === "string") {
          const k = e.address.toLowerCase();
          if (m.has(k)) duplicates = true;
          else m.set(k, e);
        }
    return m;
  };
  if (!Array.isArray(before) || !Array.isArray(after)) {
    if (!same(before, after)) out.push({ path, kind: "loosening", from: before, to: after, note: "allowlist replaced" });
    return;
  }
  const a = index(before);
  const b = index(after);
  for (const [addr, e] of b) {
    const old = a.get(addr);
    if (!old) {
      out.push({ path: `${path}[${addr}]`, kind: "loosening", from: null, to: e, note: `contract ${addr} added to the allowlist` });
      continue;
    }
    const oldSel = new Set((old.selectors ?? []).map((s) => String(s).toLowerCase()));
    const newSel = new Set((e.selectors ?? []).map((s) => String(s).toLowerCase()));
    for (const s of newSel) if (!oldSel.has(s)) out.push({ path: `${path}[${addr}].selectors`, kind: "loosening", from: null, to: s, note: `function ${s} allowed on ${addr}` });
    for (const s of oldSel) if (!newSel.has(s)) out.push({ path: `${path}[${addr}].selectors`, kind: "tightening", from: s, to: null, note: `function ${s} no longer allowed on ${addr}` });
    if (old.require_verified_code !== e.require_verified_code)
      out.push({
        path: `${path}[${addr}].require_verified_code`,
        kind: e.require_verified_code === true ? "tightening" : "loosening",
        from: old.require_verified_code,
        to: e.require_verified_code,
        note: `verified code ${e.require_verified_code ? "now required" : "no longer required"} for ${addr}`,
      });
    const known = new Set(["address", "selectors", "require_verified_code"]);
    for (const k of new Set([...Object.keys(old), ...Object.keys(e)]))
      if (!known.has(k) && !same((old as never)[k], (e as never)[k]))
        out.push({ path: `${path}[${addr}].${k}`, kind: "loosening", from: (old as never)[k], to: (e as never)[k], note: "unrecognised allowlist field changed" });
  }
  for (const [addr, e] of a) if (!b.has(addr)) out.push({ path: `${path}[${addr}]`, kind: "tightening", from: e, to: null, note: `contract ${addr} removed from the allowlist` });
  // Repeated addresses make the effective entry depend on order: never classify that as harmless.
  if (duplicates) out.push({ path, kind: "loosening", from: null, to: null, note: "an address appears more than once in the allowlist" });
}

function denylist(before: unknown, after: unknown, out: PolicyChange[]) {
  const path = "$.contracts.denylist";
  if (!Array.isArray(before) || !Array.isArray(after)) {
    if (!same(before, after)) out.push({ path, kind: "loosening", from: before, to: after, note: "denylist replaced" });
    return;
  }
  const a = new Set(before.map(lower));
  const b = new Set(after.map(lower));
  for (const x of b) if (!a.has(x)) out.push({ path, kind: "tightening", from: null, to: x, note: `${String(x)} added to the denylist` });
  for (const x of a) if (!b.has(x)) out.push({ path, kind: "loosening", from: x, to: null, note: `${String(x)} removed from the denylist` });
}

function walk(path: string, a: unknown, b: unknown, out: PolicyChange[]) {
  if (IGNORED.has(path) || same(a, b)) return;
  if (path === "$.contracts.allowlist") return allowlist(a, b, out);
  if (path === "$.contracts.denylist") return denylist(a, b, out);
  if (NUMERIC[path]) return void out.push(numeric(path, a, b));
  if (STRICT_BOOL[path] && typeof a === "boolean" && typeof b === "boolean") {
    const r = STRICT_BOOL[path]!;
    return void out.push({ path, kind: b === r.strict ? "tightening" : "loosening", from: a, to: b, note: `${r.label}: ${String(a)} to ${String(b)}` });
  }
  if (path === "$.upoch_recovery.on_unavailable")
    return void out.push({ path, kind: b === "deny" ? "tightening" : "loosening", from: a, to: b, note: `no Upoch data: ${String(a)} to ${String(b)}` });
  if (path === "$.upoch_recovery") {
    if (a === undefined && b && typeof b === "object")
      return void out.push({ path, kind: "tightening", from: null, to: b, note: "Upoch recovery rule added" });
    if (b === undefined && a && typeof a === "object") {
      const s = a as Record<string, unknown>;
      return void out.push({ path, kind: s.require_upoch_recoverable === true ? "loosening" : "tightening", from: a, to: null, note: "Upoch recovery rule removed" });
    }
  }
  if (path === "$.asset_safety.on_simulation_unavailable")
    return void out.push({ path, kind: b === "deny" ? "tightening" : "loosening", from: a, to: b, note: `no simulation: ${String(a)} to ${String(b)}` });
  if (path === "$.asset_safety") {
    // Adding the section can only add checks (or, switched off, change nothing).
    if (a === undefined && b && typeof b === "object") {
      const s = b as Record<string, unknown>;
      return void out.push({ path, kind: "tightening", from: null, to: b, note: `asset safety added (${s.enabled === true ? "on" : "off"})` });
    }
    if (b === undefined && a && typeof a === "object") {
      const s = a as Record<string, unknown>;
      return void out.push({ path, kind: s.enabled === true ? "loosening" : "tightening", from: a, to: null, note: "asset safety removed" });
    }
  }
  const isObj = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) walk(`${path}.${k}`, (a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], out);
    return;
  }
  out.push({ path, kind: "loosening", from: a ?? null, to: b ?? null, note: "change that cannot be classified safely, treated as loosening" });
}

/**
 * `before` is the version that decides today (null when there is none, or the policy is disabled:
 * then everything is denied, and any activation loosens).
 */
export function classifyPolicyChange(before: Policy | null, after: Policy, opts: { disabled?: boolean } = {}): Classification {
  const changes: PolicyChange[] = [];
  if (!before || opts.disabled) {
    changes.push({
      path: "$",
      kind: "loosening",
      from: null,
      to: { policy_id: after.policy_id },
      note: before ? "re-enables a disabled policy (it currently denies everything)" : "first version: the policy currently denies everything",
    });
    if (before) walk("$", before, after, changes);
    return { changes, loosening: true };
  }
  walk("$", before, after, changes);
  return { changes, loosening: changes.some((c) => c.kind === "loosening") };
}

/** One line per change, for alerts and webhooks. */
export function summarizeChanges(changes: PolicyChange[]): string {
  if (changes.length === 0) return "No rule changes.";
  const l = changes.filter((c) => c.kind === "loosening").length;
  const t = changes.length - l;
  return `${l} loosening, ${t} tightening: ${changes.slice(0, 6).map((c) => c.note).join("; ")}${changes.length > 6 ? `; and ${changes.length - 6} more` : ""}.`;
}

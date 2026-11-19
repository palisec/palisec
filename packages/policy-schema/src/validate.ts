import { SCHEMA_VERSIONS, type Policy } from "./types";

export interface ValidationError {
  path: string;
  message: string;
}

const UINT = /^(0|[1-9][0-9]{0,77})$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SELECTOR = /^0x[0-9a-fA-F]{8}$/;
const POLICY_ID = /^[a-z0-9_]{3,64}$/;
const MAX_ALLOWLIST = 256;
const MAX_SELECTORS = 64;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validates a policy document against schema 1.0 or 1.1. Unknown fields are rejected so a
 * typo can never silently disable a rule. Returns an empty array when valid.
 */
export function validatePolicy(doc: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });

  const fields = (o: Obj, path: string, allowed: string[]) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) err(`${path}.${k}`, "unknown field");
  };
  const obj = (o: Obj, key: string, path: string): Obj | null => {
    const v = o[key];
    if (!isObj(v)) {
      err(`${path}.${key}`, "required object");
      return null;
    }
    return v;
  };
  const uint = (o: Obj, key: string, path: string) => {
    const v = o[key];
    if (typeof v !== "string" || !UINT.test(v)) err(`${path}.${key}`, "must be a non-negative integer string");
  };
  const int = (o: Obj, key: string, path: string, min: number, max: number) => {
    const v = o[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
      err(`${path}.${key}`, `must be an integer between ${min} and ${max}`);
  };
  const bool = (o: Obj, key: string, path: string) => {
    if (typeof o[key] !== "boolean") err(`${path}.${key}`, "must be a boolean");
  };
  const address = (v: unknown, path: string) => {
    if (typeof v !== "string" || !ADDRESS.test(v)) err(path, "must be a 20-byte hex address");
  };

  if (!isObj(doc)) return [{ path: "$", message: "policy must be an object" }];
  const $ = "$";
  fields(doc, $, [
    "schema_version", "policy_id", "version", "account", "status",
    "limits", "cooldowns", "contracts", "human_approval", "failure_mode", "asset_safety",
  ]);

  if (!(SCHEMA_VERSIONS as readonly unknown[]).includes(doc.schema_version)) err("$.schema_version", 'must be "1.0" or "1.1"');
  if (typeof doc.policy_id !== "string" || !POLICY_ID.test(doc.policy_id))
    err("$.policy_id", "must be 3-64 chars of a-z, 0-9, _");
  int(doc, "version", $, 1, 2 ** 31 - 1);
  if (!["draft", "active", "disabled"].includes(doc.status as string))
    err("$.status", 'must be "draft", "active" or "disabled"');
  if (doc.failure_mode !== "closed") err("$.failure_mode", 'must be "closed"; fail-open is not supported');

  const account = obj(doc, "account", $);
  if (account) {
    fields(account, "$.account", ["chain_id", "address"]);
    int(account, "chain_id", "$.account", 1, 2 ** 31 - 1);
    address(account.address, "$.account.address");
  }

  const limits = obj(doc, "limits", $);
  if (limits) {
    fields(limits, "$.limits", [
      "max_transaction_value_wei", "max_gas_cost_wei", "hourly_budget_usd_micros",
      "max_pending_operations", "max_price_age_seconds",
    ]);
    uint(limits, "max_transaction_value_wei", "$.limits");
    uint(limits, "max_gas_cost_wei", "$.limits");
    uint(limits, "hourly_budget_usd_micros", "$.limits");
    int(limits, "max_pending_operations", "$.limits", 0, 1000);
    int(limits, "max_price_age_seconds", "$.limits", 1, 3600);
  }

  const cooldowns = obj(doc, "cooldowns", $);
  if (cooldowns) {
    fields(cooldowns, "$.cooldowns", ["identical_calldata_seconds", "identical_intent_seconds"]);
    int(cooldowns, "identical_calldata_seconds", "$.cooldowns", 0, 86400);
    int(cooldowns, "identical_intent_seconds", "$.cooldowns", 0, 86400);
  }

  const contracts = obj(doc, "contracts", $);
  if (contracts) {
    fields(contracts, "$.contracts", ["default", "allowlist", "denylist"]);
    if (contracts.default !== "deny") err("$.contracts.default", 'must be "deny"');
    const list = contracts.allowlist;
    if (!Array.isArray(list)) err("$.contracts.allowlist", "required array");
    else {
      if (list.length > MAX_ALLOWLIST) err("$.contracts.allowlist", `at most ${MAX_ALLOWLIST} entries`);
      list.forEach((entry, i) => {
        const p = `$.contracts.allowlist[${i}]`;
        if (!isObj(entry)) return err(p, "must be an object");
        fields(entry, p, ["address", "selectors", "require_verified_code"]);
        address(entry.address, `${p}.address`);
        bool(entry, "require_verified_code", p);
        if (!Array.isArray(entry.selectors)) err(`${p}.selectors`, "required array");
        else {
          if (entry.selectors.length > MAX_SELECTORS) err(`${p}.selectors`, `at most ${MAX_SELECTORS} selectors`);
          entry.selectors.forEach((s, j) => {
            if (typeof s !== "string" || !SELECTOR.test(s)) err(`${p}.selectors[${j}]`, "must be a 4-byte hex selector");
          });
        }
      });
    }
    const deny = contracts.denylist;
    if (!Array.isArray(deny)) err("$.contracts.denylist", "required array");
    else deny.forEach((a, i) => address(a, `$.contracts.denylist[${i}]`));
  }

  const human = obj(doc, "human_approval", $);
  if (human) {
    fields(human, "$.human_approval", ["usd_threshold_micros", "require_for_unknown_methods"]);
    uint(human, "usd_threshold_micros", "$.human_approval");
    bool(human, "require_for_unknown_methods", "$.human_approval");
  }

  if (doc.asset_safety !== undefined) {
    if (doc.schema_version !== "1.1") err("$.asset_safety", 'requires schema_version "1.1"');
    const safety = obj(doc, "asset_safety", $);
    if (safety) {
      const p = "$.asset_safety";
      fields(safety, p, [
        "enabled", "max_transfer_tax_bps", "max_slippage_bps", "require_sell_simulation",
        "block_unlimited_approvals", "on_simulation_unavailable", "max_simulation_age_seconds",
      ]);
      bool(safety, "enabled", p);
      int(safety, "max_transfer_tax_bps", p, 0, 10000);
      int(safety, "max_slippage_bps", p, 0, 10000);
      bool(safety, "require_sell_simulation", p);
      bool(safety, "block_unlimited_approvals", p);
      if (safety.on_simulation_unavailable !== "deny" && safety.on_simulation_unavailable !== "review")
        err(`${p}.on_simulation_unavailable`, 'must be "deny" or "review"');
      int(safety, "max_simulation_age_seconds", p, 1, 300);
    }
  }

  return errors;
}

export function isValidPolicy(doc: unknown): doc is Policy {
  return validatePolicy(doc).length === 0;
}

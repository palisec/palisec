//! Policy schema 1.0 and 1.1 validation. Mirrors `validatePolicy` in packages/policy-schema: same rules,
//! same paths, same messages, same order. Unknown fields are rejected so a typo cannot disable a rule.

use crate::js::{int_in, is_address, is_policy_id, is_selector, is_uint, js_keys};
use serde_json::{json, Map, Value};

pub const SCHEMA_VERSIONS: [&str; 2] = ["1.0", "1.1"];
const MAX_ALLOWLIST: usize = 256;
const MAX_SELECTORS: usize = 64;
const I31: i64 = 2_147_483_647;

pub struct Validator {
    pub errors: Vec<(String, String)>,
}

impl Validator {
    fn err(&mut self, path: impl Into<String>, message: impl Into<String>) {
        self.errors.push((path.into(), message.into()));
    }

    fn fields(&mut self, o: &Map<String, Value>, path: &str, allowed: &[&str]) {
        for k in js_keys(o) {
            if !allowed.contains(&k.as_str()) {
                self.err(format!("{path}.{k}"), "unknown field");
            }
        }
    }

    fn obj<'a>(&mut self, o: &'a Map<String, Value>, key: &str, path: &str) -> Option<&'a Map<String, Value>> {
        match o.get(key) {
            Some(Value::Object(m)) => Some(m),
            _ => {
                self.err(format!("{path}.{key}"), "required object");
                None
            }
        }
    }

    fn uint(&mut self, o: &Map<String, Value>, key: &str, path: &str) {
        let ok = matches!(o.get(key), Some(Value::String(s)) if is_uint(s));
        if !ok {
            self.err(format!("{path}.{key}"), "must be a non-negative integer string");
        }
    }

    fn int(&mut self, o: &Map<String, Value>, key: &str, path: &str, min: i64, max: i64) {
        if !int_in(o.get(key), min, max) {
            self.err(format!("{path}.{key}"), format!("must be an integer between {min} and {max}"));
        }
    }

    fn bool(&mut self, o: &Map<String, Value>, key: &str, path: &str) {
        if !matches!(o.get(key), Some(Value::Bool(_))) {
            self.err(format!("{path}.{key}"), "must be a boolean");
        }
    }

    fn address(&mut self, v: Option<&Value>, path: String) {
        if !matches!(v, Some(Value::String(s)) if is_address(s)) {
            self.err(path, "must be a 20-byte hex address");
        }
    }
}

/// Returns `(path, message)` pairs; empty when the policy is valid.
pub fn validate(doc: &Value) -> Vec<(String, String)> {
    let Value::Object(doc) = doc else {
        return vec![("$".into(), "policy must be an object".into())];
    };
    let mut v = Validator { errors: Vec::new() };
    v.fields(
        doc,
        "$",
        &["schema_version", "policy_id", "version", "account", "status", "limits", "cooldowns", "contracts", "human_approval", "failure_mode", "asset_safety"],
    );

    if !matches!(doc.get("schema_version"), Some(Value::String(s)) if SCHEMA_VERSIONS.contains(&s.as_str())) {
        v.err("$.schema_version", "must be \"1.0\" or \"1.1\"");
    }
    if !matches!(doc.get("policy_id"), Some(Value::String(s)) if is_policy_id(s)) {
        v.err("$.policy_id", "must be 3-64 chars of a-z, 0-9, _");
    }
    v.int(doc, "version", "$", 1, I31);
    if !matches!(doc.get("status"), Some(Value::String(s)) if s == "draft" || s == "active" || s == "disabled") {
        v.err("$.status", "must be \"draft\", \"active\" or \"disabled\"");
    }
    if doc.get("failure_mode") != Some(&Value::String("closed".into())) {
        v.err("$.failure_mode", "must be \"closed\"; fail-open is not supported");
    }

    if let Some(account) = v.obj(doc, "account", "$") {
        v.fields(account, "$.account", &["chain_id", "address"]);
        v.int(account, "chain_id", "$.account", 1, I31);
        v.address(account.get("address"), "$.account.address".into());
    }

    if let Some(limits) = v.obj(doc, "limits", "$") {
        v.fields(
            limits,
            "$.limits",
            &["max_transaction_value_wei", "max_gas_cost_wei", "hourly_budget_usd_micros", "max_pending_operations", "max_price_age_seconds"],
        );
        v.uint(limits, "max_transaction_value_wei", "$.limits");
        v.uint(limits, "max_gas_cost_wei", "$.limits");
        v.uint(limits, "hourly_budget_usd_micros", "$.limits");
        v.int(limits, "max_pending_operations", "$.limits", 0, 1000);
        v.int(limits, "max_price_age_seconds", "$.limits", 1, 3600);
    }

    if let Some(cooldowns) = v.obj(doc, "cooldowns", "$") {
        v.fields(cooldowns, "$.cooldowns", &["identical_calldata_seconds", "identical_intent_seconds"]);
        v.int(cooldowns, "identical_calldata_seconds", "$.cooldowns", 0, 86400);
        v.int(cooldowns, "identical_intent_seconds", "$.cooldowns", 0, 86400);
    }

    if let Some(contracts) = v.obj(doc, "contracts", "$") {
        v.fields(contracts, "$.contracts", &["default", "allowlist", "denylist"]);
        if contracts.get("default") != Some(&Value::String("deny".into())) {
            v.err("$.contracts.default", "must be \"deny\"");
        }
        match contracts.get("allowlist") {
            Some(Value::Array(list)) => {
                if list.len() > MAX_ALLOWLIST {
                    v.err("$.contracts.allowlist", format!("at most {MAX_ALLOWLIST} entries"));
                }
                for (i, entry) in list.iter().enumerate() {
                    let p = format!("$.contracts.allowlist[{i}]");
                    let Value::Object(entry) = entry else {
                        v.err(p, "must be an object");
                        continue;
                    };
                    v.fields(entry, &p, &["address", "selectors", "require_verified_code"]);
                    v.address(entry.get("address"), format!("{p}.address"));
                    v.bool(entry, "require_verified_code", &p);
                    match entry.get("selectors") {
                        Some(Value::Array(sels)) => {
                            if sels.len() > MAX_SELECTORS {
                                v.err(format!("{p}.selectors"), format!("at most {MAX_SELECTORS} selectors"));
                            }
                            for (j, s) in sels.iter().enumerate() {
                                if !matches!(s, Value::String(s) if is_selector(s)) {
                                    v.err(format!("{p}.selectors[{j}]"), "must be a 4-byte hex selector");
                                }
                            }
                        }
                        _ => v.err(format!("{p}.selectors"), "required array"),
                    }
                }
            }
            _ => v.err("$.contracts.allowlist", "required array"),
        }
        match contracts.get("denylist") {
            Some(Value::Array(deny)) => {
                for (i, a) in deny.iter().enumerate() {
                    v.address(Some(a), format!("$.contracts.denylist[{i}]"));
                }
            }
            _ => v.err("$.contracts.denylist", "required array"),
        }
    }

    if let Some(human) = v.obj(doc, "human_approval", "$") {
        v.fields(human, "$.human_approval", &["usd_threshold_micros", "require_for_unknown_methods"]);
        v.uint(human, "usd_threshold_micros", "$.human_approval");
        v.bool(human, "require_for_unknown_methods", "$.human_approval");
    }

    if doc.contains_key("asset_safety") {
        if doc.get("schema_version") != Some(&Value::String("1.1".into())) {
            v.err("$.asset_safety", "requires schema_version \"1.1\"");
        }
        if let Some(safety) = v.obj(doc, "asset_safety", "$") {
            let p = "$.asset_safety";
            v.fields(
                safety,
                p,
                &[
                    "enabled",
                    "max_transfer_tax_bps",
                    "max_slippage_bps",
                    "require_sell_simulation",
                    "block_unlimited_approvals",
                    "on_simulation_unavailable",
                    "max_simulation_age_seconds",
                ],
            );
            v.bool(safety, "enabled", p);
            v.int(safety, "max_transfer_tax_bps", p, 0, 10000);
            v.int(safety, "max_slippage_bps", p, 0, 10000);
            v.bool(safety, "require_sell_simulation", p);
            v.bool(safety, "block_unlimited_approvals", p);
            if !matches!(safety.get("on_simulation_unavailable"), Some(Value::String(s)) if s == "deny" || s == "review") {
                v.err(format!("{p}.on_simulation_unavailable"), "must be \"deny\" or \"review\"");
            }
            v.int(safety, "max_simulation_age_seconds", p, 1, 300);
        }
    }

    v.errors
}

/// The `ValidationError[]` shape the TypeScript validator returns.
pub fn validate_json(doc: &Value) -> Value {
    Value::Array(validate(doc).into_iter().map(|(path, message)| json!({ "path": path, "message": message })).collect())
}

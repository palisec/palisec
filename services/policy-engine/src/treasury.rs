//! Treasury guard (schema 1.6). Mirrors `treasuryCheck` in packages/policy-schema/src/simulator.ts: same
//! order, codes and wording. The simulation and the 24-hour sell window are inputs made before evaluation;
//! malformed input is an engine error (the dual evaluator then fails closed), raised where the reference throws.

use crate::asset::Asset::{self, *};
use crate::asset::{amount_of, bool_of, int_of, list_of, record_of, str_of};
use crate::js::{big, lower};
use num_bigint::BigUint;
use serde_json::Value;
use std::collections::HashSet;

pub const TREASURY_MAX_INPUT_AGE: i64 = 120;

type Res<T> = Result<T, String>;

struct Move {
    token: String,
    who: String,
    amount: BigUint,
}

fn moves(v: Option<&Value>, what: &str, who: &str) -> Res<Vec<Move>> {
    let mut out = Vec::new();
    for x in list_of(v, what)? {
        let o = record_of(Some(x), what)?;
        out.push(Move {
            token: lower(str_of(o.get("token"), &format!("{what}.token"))?),
            who: lower(str_of(o.get(who), &format!("{what}.{who}"))?),
            amount: amount_of(o.get("amount"), &format!("{what}.amount"))?,
        });
    }
    Ok(out)
}

fn set(g: &serde_json::Map<String, Value>, k: &str) -> HashSet<String> {
    g.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(lower).collect()).unwrap_or_default()
}

/// The cap for the rolling 24 hours: the smaller of the absolute amount and the share of the window's holdings.
fn cap_of(cap: Option<&Value>, holdings: &BigUint) -> Option<BigUint> {
    let cap = cap?.as_object()?;
    let mut c: Option<BigUint> = cap.get("amount").and_then(Value::as_str).map(big);
    if let Some(bps) = cap.get("pct_of_holdings_bps").and_then(crate::js::int) {
        let p = holdings * BigUint::from(bps as u64) / BigUint::from(10000u32);
        c = Some(match c {
            Some(x) if x <= p => x,
            _ => p,
        });
    }
    c
}

pub fn check(policy: &Value, env: &Value, now: i64, selector: Option<&str>) -> Res<Asset> {
    let g = match policy.get("treasury_guard") {
        Some(Value::Object(g)) if g.get("enabled") == Some(&Value::Bool(true)) => g,
        _ => return Ok(Pass("No treasury guard on this policy.".into())),
    };
    if selector.is_none() {
        return Ok(Pass("Native transfer: the project token cannot move.".into()));
    }
    let unknown = |why: String| Fail("PS_SIM_002", format!("{why} The project token's movement cannot be determined, so the request fails closed."));
    let sim = match env.get("asset_simulation") {
        None | Some(Value::Null) => return Ok(unknown("Simulation unavailable.".into())),
        v => record_of(v, "asset_simulation")?,
    };
    let age = now - int_of(sim.get("observed_at"), "observed_at")?;
    if age > TREASURY_MAX_INPUT_AGE {
        return Ok(unknown(format!("Simulation is {age}s old; maximum is {TREASURY_MAX_INPUT_AGE}s.")));
    }
    if bool_of(sim.get("reverted"), "reverted")? {
        return Ok(unknown("The transaction reverts in simulation.".into()));
    }
    if sim.get("transfers_out").is_none() {
        return Ok(unknown("The simulation does not list the account's transfers.".into()));
    }

    let pt = lower(g.get("project_token").and_then(Value::as_str).unwrap_or(""));
    let venues = set(g, "allowed_sell_venues");
    let dests = set(g, "allowed_destinations");
    let lps = set(g, "lp_tokens");

    let transfers = moves(sim.get("transfers_out"), "transfers_out", "to")?;
    let approvals = moves(sim.get("approvals"), "approvals", "spender")?;
    let after = match sim.get("allowances_after") {
        None => None,
        v => Some(moves(v, "allowances_after", "spender")?),
    };
    let zero = BigUint::default();

    if g.get("protect_liquidity") == Some(&Value::Bool(true)) {
        if let Some(t) = transfers.iter().find(|t| lps.contains(&t.token) && t.amount > zero) {
            return Ok(Fail("PS_TREASURY_004", format!("LP token {} would leave the account (to {}); liquidity is protected.", t.token, t.who)));
        }
        if let Some(a) = approvals.iter().find(|a| lps.contains(&a.token) && a.amount > zero) {
            return Ok(Fail("PS_TREASURY_004", format!("LP token {} would be approved to {}; liquidity is protected.", a.token, a.who)));
        }
    }

    let mut sold = BigUint::default();
    for t in &transfers {
        if t.token != pt || t.amount == zero {
            continue;
        }
        if venues.contains(&t.who) {
            sold += &t.amount;
        } else if !dests.contains(&t.who) {
            return Ok(Fail(
                "PS_TREASURY_001",
                format!("{} of the project token would go to {}, which is not an allowed destination or sell venue.", t.amount, t.who),
            ));
        }
    }

    let pt_approvals: Vec<&Move> = approvals.iter().filter(|a| a.token == pt).collect();
    if sold == zero && pt_approvals.is_empty() {
        return Ok(Pass("The project token does not leave the account and is not approved.".into()));
    }

    let win = match env.get("treasury") {
        None | Some(Value::Null) => return Ok(Fail("PS_STATE_001", "The 24-hour sell window is unavailable, so the cap cannot be enforced.".into())),
        v => record_of(v, "treasury")?,
    };
    let win_age = now - int_of(win.get("observed_at"), "treasury.observed_at")?;
    if win_age > TREASURY_MAX_INPUT_AGE {
        return Ok(Fail("PS_STATE_001", format!("The sell window is {win_age}s old; maximum is {TREASURY_MAX_INPUT_AGE}s.")));
    }
    let used = amount_of(win.get("sold_24h"), "treasury.sold_24h")?;
    let holdings = amount_of(win.get("holdings_at_window_start"), "treasury.holdings_at_window_start")?;
    let cap = cap_of(g.get("daily_sell_cap"), &holdings);
    let after_sells = &used + &sold;
    let left = cap.as_ref().map(|c| if *c > after_sells { c - &after_sells } else { BigUint::default() });

    let unlimited = BigUint::from(1u8) << 128u32;
    for a in &pt_approvals {
        if a.amount >= unlimited {
            return Ok(Fail("PS_TREASURY_003", format!("Unlimited approval of the project token to {}.", a.who)));
        }
        if !venues.contains(&a.who) {
            return Ok(Fail("PS_TREASURY_003", format!("Approval of the project token to {}, which is not an allowed sell venue.", a.who)));
        }
        let open = match &after {
            Some(list) => list.iter().find(|x| x.token == pt && x.who == a.who).map(|x| x.amount.clone()).unwrap_or_default(),
            None => a.amount.clone(),
        };
        if let Some(l) = &left {
            if open > *l {
                return Ok(Fail(
                    "PS_TREASURY_003",
                    format!("Approval leaves {} of the project token open to {}; only {} is left under the daily cap.", open, a.who, l),
                ));
            }
        }
    }

    if let Some(c) = &cap {
        if after_sells > *c {
            return Ok(Fail("PS_TREASURY_002", format!("{} sold in the last 24 hours + {} now exceeds the daily cap of {}.", used, sold, c)));
        }
    }
    Ok(Pass(match &cap {
        None => format!("Sells {sold} through an allowed venue (no daily cap)."),
        Some(c) => format!("Sells {sold}; {after_sells} of the {c} daily cap after this."),
    }))
}

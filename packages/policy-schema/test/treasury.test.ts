import { describe, expect, it } from "vitest";
import { evaluate, treasuryLockViolation, validatePolicy, type Policy } from "../src";
import { GUARD, guardPolicy, TREASURY_CASES } from "./treasury-cases";
import { NOW } from "./spend-cases";

describe("treasury guard: decisions", () => {
  for (const c of TREASURY_CASES)
    it(c.name, () => {
      const r = evaluate(c.policy, c.intent, c.state, c.env);
      expect([r.decision, r.reason_code]).toEqual([c.decision, c.code]);
    });
});

describe("treasury guard: schema", () => {
  it("validates and needs schema 1.6", () => {
    expect(validatePolicy(guardPolicy())).toEqual([]);
    expect(validatePolicy({ ...guardPolicy(), schema_version: "1.5" })).toContainEqual({ path: "$.treasury_guard", message: 'requires schema_version "1.6" or later' });
    const bad = guardPolicy() as unknown as Record<string, any>;
    bad.treasury_guard.approvals = "any";
    bad.treasury_guard.daily_sell_cap.pct_of_holdings_bps = 10001;
    const errs = validatePolicy(bad).map((e) => e.path);
    expect(errs).toContain("$.treasury_guard.approvals");
    expect(errs).toContain("$.treasury_guard.daily_sell_cap.pct_of_holdings_bps");
  });
});

describe("treasury guard: the lock", () => {
  const before = guardPolicy();
  const change = (g: Partial<typeof GUARD>): Policy => ({ ...before, treasury_guard: { ...before.treasury_guard!, ...g } });
  const loosen: [string, Policy | null][] = [
    ["raising the cap", change({ daily_sell_cap: { amount: (3000n * 10n ** 18n).toString(), pct_of_holdings_bps: null } })],
    ["removing the cap", change({ daily_sell_cap: { amount: null, pct_of_holdings_bps: null } })],
    ["adding a destination", change({ allowed_destinations: [...GUARD.allowed_destinations, "0x9999999999999999999999999999999999999999"] })],
    ["adding a sell venue", change({ allowed_sell_venues: [...GUARD.allowed_sell_venues, "0x9999999999999999999999999999999999999999"] })],
    ["switching liquidity protection off", change({ protect_liquidity: false })],
    ["unprotecting an LP token", change({ lp_tokens: [] })],
    ["shortening the lock", change({ locked_until: NOW + 86400 })],
    ["switching the guard off", change({ enabled: false })],
    ["changing the project token", change({ project_token: "0x9999999999999999999999999999999999999999" })],
    ["removing the guard", (() => { const p = { ...before }; delete p.treasury_guard; return p; })()],
    ["deleting the policy", null],
  ];
  for (const [what, after] of loosen)
    it(`rejects ${what} while locked`, () => expect(treasuryLockViolation(before, after, NOW)).not.toBeNull());
  const tighten: [string, Policy][] = [
    ["lowering the cap", change({ daily_sell_cap: { amount: (1000n * 10n ** 18n).toString(), pct_of_holdings_bps: null } })],
    ["adding a percentage cap", change({ daily_sell_cap: { amount: GUARD.daily_sell_cap.amount, pct_of_holdings_bps: 100 } })],
    ["removing a destination", change({ allowed_destinations: [] })],
    ["extending the lock", change({ locked_until: GUARD.locked_until + 86400 })],
    ["changing an unrelated limit downward", { ...before, limits: { ...before.limits, hourly_budget_usd_micros: "1" } }],
  ];
  for (const [what, after] of tighten)
    it(`allows ${what} while locked`, () => expect(treasuryLockViolation(before, after, NOW)).toBeNull());
  it("lets loosening through (to the normal delay) once the lock has passed", () => {
    expect(treasuryLockViolation(before, change({ protect_liquidity: false }), GUARD.locked_until + 1)).toBeNull();
  });
});

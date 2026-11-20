import { describe, expect, it } from "vitest";
import { compileProposal, EXAMPLE_POLICY, outsideEnvelope, replayBalances, tally, validateChange, validateEnvelope, type MandateEnvelope, type Policy } from "../src";

const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2" as const;
const env: MandateEnvelope = {
  max_transaction_value_wei: "300000000000000",
  max_hourly_budget_usd_micros: "2000000",
  min_approval_threshold_usd_micros: "500000",
  allowed_contracts: [{ address: ROUTER, selectors: ["0x04e45aaf"] }],
};
const base: Policy = {
  ...JSON.parse(JSON.stringify(EXAMPLE_POLICY)),
  schema_version: "1.1",
  limits: { ...EXAMPLE_POLICY.limits, max_transaction_value_wei: "100000000000000", hourly_budget_usd_micros: "1000000" },
  contracts: { default: "deny", allowlist: [], denylist: [] },
  human_approval: { usd_threshold_micros: "1000000", require_for_unknown_methods: false },
};
const W = (n: number) => (BigInt(n) * 10n ** 18n).toString();

describe("mandate envelope", () => {
  it("validates envelopes and changes", () => {
    expect(validateEnvelope(env)).toEqual([]);
    expect(validateEnvelope({ ...env, extra: 1 })).not.toEqual([]);
    expect(validateChange({ kind: "set_hourly_budget", usd_micros: "1500000" })).toEqual([]);
    expect(validateChange({ kind: "set_hourly_budget", usd_micros: "1.5" })).not.toEqual([]);
    expect(validateChange({ kind: "nope" })).not.toEqual([]);
  });
  it("a proposal outside the envelope is rejected", () => {
    expect(outsideEnvelope({ kind: "set_hourly_budget", usd_micros: "2000001" }, env)).toMatch(/above/);
    expect(outsideEnvelope({ kind: "set_max_transaction_value", wei: "300000000000001" }, env)).toMatch(/above/);
    expect(outsideEnvelope({ kind: "set_approval_threshold", usd_micros: "499999" }, env)).toMatch(/below/);
    expect(outsideEnvelope({ kind: "allow_contract", address: "0x9999999999999999999999999999999999999999", selectors: [] }, env)).toMatch(/not in/);
    expect(outsideEnvelope({ kind: "allow_contract", address: ROUTER, selectors: ["0xdeadbeef"] }, env)).toMatch(/function/);
    expect(compileProposal(base, { kind: "set_hourly_budget", usd_micros: "9000000" }, env).ok).toBe(false);
  });
  it("at exactly the envelope limits it is inside", () => {
    expect(outsideEnvelope({ kind: "set_hourly_budget", usd_micros: "2000000" }, env)).toBeNull();
    expect(outsideEnvelope({ kind: "set_approval_threshold", usd_micros: "500000" }, env)).toBeNull();
  });
  it("compiles a passed proposal into a valid policy inside the envelope", () => {
    const r = compileProposal(base, { kind: "set_hourly_budget", usd_micros: "1500000" }, env);
    expect(r.ok && r.document.limits.hourly_budget_usd_micros).toBe("1500000");
    const a = compileProposal(base, { kind: "allow_contract", address: ROUTER, selectors: ["0x04e45aaf"] }, env);
    expect(a.ok && a.document.contracts.allowlist).toEqual([{ address: ROUTER, selectors: ["0x04e45aaf"], require_verified_code: true }]);
  });
  it("a current policy already outside the envelope cannot be compiled (fail closed)", () => {
    const wide = { ...base, limits: { ...base.limits, hourly_budget_usd_micros: "5000000" } };
    expect(compileProposal(wide, { kind: "set_approval_threshold", usd_micros: "600000" }, env).ok).toBe(false);
  });
});

describe("mandate tally", () => {
  const rules = { quorum: W(1000), pass_bps: 5000 };
  it("quorum is reached at exactly the quorum", () => {
    expect(tally({ rules, votes: [{ voter: "a", choice: "for", weight: W(1000) }] }).quorum_reached).toBe(true);
    expect(tally({ rules, votes: [{ voter: "a", choice: "for", weight: (BigInt(W(1000)) - 1n).toString() }] }).quorum_reached).toBe(false);
  });
  it("exactly 50% does not pass; just above does", () => {
    expect(tally({ rules, votes: [{ voter: "a", choice: "for", weight: W(600) }, { voter: "b", choice: "against", weight: W(600) }] }).passed).toBe(false);
    expect(tally({ rules, votes: [{ voter: "a", choice: "for", weight: (BigInt(W(600)) + 1n).toString() }, { voter: "b", choice: "against", weight: W(600) }] }).passed).toBe(true);
  });
  it("abstain counts toward quorum, not toward passing", () => {
    const t = tally({ rules, votes: [{ voter: "a", choice: "abstain", weight: W(900) }, { voter: "b", choice: "for", weight: W(100) }] });
    expect(t.quorum_reached).toBe(true);
    expect(t.passed).toBe(true);
    expect(tally({ rules, votes: [{ voter: "a", choice: "abstain", weight: W(2000) }] }).passed).toBe(false);
  });
});

describe("snapshot replay", () => {
  it("rebuilds balances from transfers", () => {
    const z = "0x0000000000000000000000000000000000000000";
    const b = replayBalances([
      { from: z, to: "0xA", value: 100n },
      { from: "0xA", to: "0xB", value: 30n },
      { from: "0xB", to: "0xA", value: 30n },
      { from: "0xA", to: "0xC", value: 100n },
    ]);
    expect([...b]).toEqual([["0xc", 100n]]);
  });
});

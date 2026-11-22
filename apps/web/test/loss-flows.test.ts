import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { externalFlows, flowsUsd, NATIVE, peakNow, type Movement } from "../src/lib/loss-flows.ts";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const OWNER = "0x9999999999999999999999999999999999999999";
const POOL = "0x2222222222222222222222222222222222222222";
const SOMEONE = "0x3333333333333333333333333333333333333333";
const prices = new Map([
  [NATIVE, { price: 3_000_000_000n, decimals: 18 }],
  [USDG, { price: 1_000_000n, decimals: 6 }],
]);
const priced = new Set([NATIVE, USDG]);
const exits = new Set([OWNER]);

describe("loss limit: deposits and withdrawals are not profit or loss", () => {
  it("a deposit raises value and flows equally: the adjusted value does not move", () => {
    const moves: Movement[] = [{ tx: "0xd1", token: USDG, direction: "in", other: OWNER, amount: 100_000_000n }];
    const flows = externalFlows(moves, new Set(), exits);
    assert.equal(flows[0]!.kind, "deposit");
    const f = flowsUsd(flows, prices, priced)!;
    assert.equal(f, 100_000_000n);
    // Before: $500, no flows. After the deposit: $600, flows +$100. Peak stays $600 at today's flows.
    assert.equal(peakNow([{ value: 500_000_000n, flows: 0n }], { value: 600_000_000n, flows: f }), 600_000_000n);
  });

  it("a withdrawal to the owner lowers the peak with the value: no loss", () => {
    const moves: Movement[] = [{ tx: "0xe1", token: USDG, direction: "out", other: OWNER, amount: 200_000_000n }];
    const flows = externalFlows(moves, new Set(["0xe1"]), exits);
    const f = flowsUsd(flows, prices, priced)!;
    assert.equal(f, -200_000_000n);
    const peak = peakNow([{ value: 1_000_000_000n, flows: 0n }], { value: 800_000_000n, flows: f });
    assert.equal(peak, 800_000_000n); // value 800, peak 800: loss 0
  });

  it("a payment to someone else in the account's own transaction is a loss", () => {
    const moves: Movement[] = [{ tx: "0xe2", token: USDG, direction: "out", other: SOMEONE, amount: 50_000_000n }];
    assert.deepEqual(externalFlows(moves, new Set(["0xe2"]), exits), []);
    const peak = peakNow([{ value: 1_000_000_000n, flows: 0n }], { value: 950_000_000n, flows: 0n });
    assert.equal(peak - 950_000_000n, 50_000_000n);
  });

  it("swap legs inside the account's own transaction are trading results, not deposits", () => {
    const moves: Movement[] = [
      { tx: "0xs1", token: USDG, direction: "out", other: POOL, amount: 100_000_000n },
      { tx: "0xs1", token: NATIVE, direction: "in", other: POOL, amount: 33_000_000_000_000_000n },
    ];
    assert.deepEqual(externalFlows(moves, new Set(["0xs1"]), exits), []);
  });

  it("an approved spender pulling tokens outside the account's transactions is a loss", () => {
    const moves: Movement[] = [{ tx: "0xp1", token: USDG, direction: "out", other: SOMEONE, amount: 10_000_000n }];
    assert.deepEqual(externalFlows(moves, new Set(), exits), []);
  });

  it("tokens with no price are ignored both ways; a priced token missing its price makes flows unknown", () => {
    const junk = "0x8888888888888888888888888888888888888888";
    const items = externalFlows([{ tx: "0xd2", token: junk, direction: "in", other: SOMEONE, amount: 10n ** 30n }], new Set(), exits);
    assert.equal(flowsUsd(items, prices, priced), 0n);
    const eth = externalFlows([{ tx: "0xd3", token: NATIVE, direction: "in", other: SOMEONE, amount: 1n }], new Set(), exits);
    assert.equal(flowsUsd(eth, new Map(), priced), null);
  });

  it("the peak is never negative and never below the current value", () => {
    assert.equal(peakNow([], { value: 0n, flows: 5n }), 0n);
    assert.equal(peakNow([{ value: 100n, flows: 0n }], { value: 300n, flows: 0n }), 300n);
  });
});

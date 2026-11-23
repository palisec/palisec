import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_REBUILD_HOURS, rebuildValues, windowValue, type Closes, type ValueTrade } from "../src/lib/replay-values.ts";

const BASE = 1_790_000_000 - (1_790_000_000 % 3600);
const H = (k: number) => BASE + k * 3600;
const iso = (k: number) => new Date(H(k) * 1000).toISOString();
// AAA closes from hour 15 on: 100 + hour.
const closes = new Map<string, Closes>([["AAA", Array.from({ length: 40 }, (_, i) => [H(15 + i), 100 + 15 + i] as [number, number])]]);
const trades: ValueTrade[] = [
  { at: iso(12), market: "AAA", side: "buy", quantity: 2, price: 110, cost_usd: 1 },
  { at: iso(20), market: "AAA", side: "sell", quantity: 2, price: 120, cost_usd: 1 },
];
// After both trades the account is flat: 10,000 - 220 - 1 + 240 - 1.
const FLAT = 10_018;
const equity = Array.from({ length: 10 }, (_, i) => [H(30 + i), FLAT, 9_000]);
const input = { equity, startCapital: 10_000, tradesCount: 2, trades, closes };

describe("replay account value: rebuilt from recorded trades and closes", () => {
  it("extends Zolva's own value back to a week before the first trade", () => {
    const { values, rebuilt } = rebuildValues(input);
    assert.equal(rebuilt, true);
    assert.equal(values[0]![0], H(12) - 7 * 86400);
    assert.deepEqual(values.slice(-10), equity.map(([t, v]) => [t, v]));
    const at = (k: number) => values.find(([t]) => t === H(k))![1];
    assert.equal(at(5), 10_000, "before the first trade: the start capital");
    assert.equal(at(13), null, "a held market without a close yet: no value");
    assert.equal(at(16), 10_000 - 221 + 2 * 116);
    assert.equal(at(25), FLAT);
  });

  it("never reaches further back than its bound: older trades have no value", () => {
    const old = { ...trades[0]!, at: new Date((H(0) - 400 * 86400) * 1000).toISOString(), side: "sell", quantity: 0, price: 1, cost_usd: 0 };
    const { values, rebuilt } = rebuildValues({ ...input, trades: [old, ...trades], tradesCount: 3 });
    assert.equal(rebuilt, true);
    assert.equal(values.length, MAX_REBUILD_HOURS + equity.length);
    assert.equal(windowValue(values, Date.parse(old.at) / 1000, 3600), null);
  });

  it("is not used when it differs from Zolva's own value", () => {
    const off = equity.map(([t, , h], i) => [t, i === 3 ? FLAT + 5 : FLAT, h]);
    const r = rebuildValues({ ...input, equity: off });
    assert.equal(r.rebuilt, false);
    assert.equal(r.values.length, 10);
  });

  it("is not used when Zolva publishes fewer trades than the agent made", () => {
    assert.equal(rebuildValues({ ...input, tradesCount: 3 }).rebuilt, false);
  });

  it("is not used when the closes could not be read, or for short positions", () => {
    assert.equal(rebuildValues({ ...input, closes: null }).rebuilt, false);
    assert.equal(rebuildValues({ ...input, trades: [{ ...trades[0]!, side: "short" }, trades[1]!] }).rebuilt, false);
  });
});

describe("replay account value: the loss-limit window", () => {
  const { values } = rebuildValues(input);
  it("gives the value now and the window's peak", () => {
    assert.deepEqual(windowValue(values, H(25), 10 * 3600), { value: FLAT, peak: FLAT });
    assert.deepEqual(windowValue(values, H(19), 3 * 3600), { value: 10_000 - 221 + 2 * 119, peak: 10_000 - 221 + 2 * 119 });
  });
  it("has no value when any hour in the window has none (fails closed)", () => {
    assert.equal(windowValue(values, H(18), 10 * 3600), null);
  });
  it("has no value when the window starts before the known values", () => {
    assert.equal(windowValue(values, values[0]![0] + 3600, 10 * 3600), null);
  });
  it("has no value after the last known hour", () => {
    assert.equal(windowValue(values, H(45), 3600), null);
  });
});

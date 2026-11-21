import { readFileSync } from "node:fs";
import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { canonicalize, decodeReason, encodeReason, intentHash, PALISEC_REASON_MAP, policyHash, REASONS, recoverReceiptSigner, typedReceipt, type ReceiptJson } from "../src";

const V = JSON.parse(readFileSync(new URL("../vectors/vectors.json", import.meta.url), "utf8"));

describe("JCS (RFC 8785)", () => {
  it("matches the RFC 8785 section 3.2.2 example", () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });
  it("sorts keys by UTF-16 code units", () => {
    expect(canonicalize({ "\u20ac": 1, "\r": 2, "\ufb33": 3, "1": 4, "\u{1f600}": 5, "\u0080": 6, "\u00f6": 7 })).toBe(
      '{"\\r":2,"1":4,"\u0080":6,"ö":7,"€":1,"\u{1f600}":5,"\ufb33":3}',
    );
  });
  it("rejects non-JSON values", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow();
    expect(() => canonicalize({ a: () => 1 })).toThrow();
  });
  for (const p of V.policies)
    it(`policy vector: ${p.name}`, () => {
      expect(canonicalize(p.document)).toBe(p.jcs);
      expect(policyHash(p.document)).toBe(p.policyHash);
    });
});

describe("intents", () => {
  for (const i of V.intents) it(i.name, () => expect(intentHash(i.intent)).toBe(i.intentHash));
  it("any field change changes the hash", () => {
    const i = V.intents[0].intent;
    expect(intentHash({ ...i, value: "20000000000001" })).not.toBe(V.intents[0].intentHash);
    expect(intentHash({ ...i, chainId: 46630 })).not.toBe(V.intents[0].intentHash);
  });
});

describe("receipts", () => {
  for (const r of V.receipts)
    it(r.name, async () => {
      const receipt = r.receipt as ReceiptJson;
      expect(hashTypedData(typedReceipt(receipt))).toBe(r.digest);
      expect(await recoverReceiptSigner(receipt)).toBe(V.testKeys.receiptSigner.address);
      expect(encodeReason(receipt.reasonCode)).toBe(r.encodedReason);
      expect(decodeReason(r.encodedDetail)).toBe(receipt.detailCode);
    });
  it("a tampered receipt recovers a different signer", async () => {
    const r = { ...(V.receipts[1].receipt as ReceiptJson), decision: "ALLOW" as const };
    expect(await recoverReceiptSigner(r)).not.toBe(V.testKeys.receiptSigner.address);
  });
});

describe("reason codes", () => {
  it("every code fits in bytes32 and round-trips", () => {
    for (const c of Object.keys(REASONS)) expect(decodeReason(encodeReason(c))).toBe(c);
    expect(decodeReason(encodeReason("NONE"))).toBe("NONE");
  });
  it("maps every Palisec code to a standard code", () => {
    for (const v of Object.values(PALISEC_REASON_MAP)) expect(REASONS).toHaveProperty(v);
    expect(Object.keys(PALISEC_REASON_MAP)).toHaveLength(24);
  });
});

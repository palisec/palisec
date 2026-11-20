#!/usr/bin/env node
/**
 * Recount a Palisec holder-mandate vote independently (Phase 7). Needs only Node.js, viem and a public
 * Robinhood Chain RPC; it does not trust Palisec's numbers:
 *
 *   1. every vote signature must recover to its voter for this exact mandate, proposal, choice and snapshot block;
 *   2. the balances at the snapshot block are rebuilt from the token's Transfer logs (token creation to the
 *      snapshot block), and must equal both the file's snapshot table and each vote's weight;
 *   3. the result is recomputed (quorum on all votes cast; passes when for / (for + against) > pass_bps).
 *
 *   node recount-mandate.mjs <vote-file.json | https://palisec.tech/api/v1/public/mandates/<slug>/proposals/<id>/vote-file> [rpc]
 */
import { readFileSync } from "node:fs";
import { createPublicClient, http, parseAbiItem, recoverTypedDataAddress } from "viem";

const [src, rpcArg] = process.argv.slice(2);
if (!src) throw new Error("usage: node recount-mandate.mjs <vote file path or URL> [rpc]");
const file = src.startsWith("http") ? await (await fetch(src)).json() : JSON.parse(readFileSync(src, "utf8"));
const RPC = rpcArg ?? (file.chain_id === 4663 ? "https://rpc.mainnet.chain.robinhood.com" : "https://rpc.testnet.chain.robinhood.com");
const CHOICES = ["for", "against", "abstain"];
const STEP = 9_999_999n;
const lc = (a) => a.toLowerCase();

console.log(`Recount of ${file.mandate.slug} proposal #${file.proposal.number} (${file.proposal.title})`);
console.log(`Token ${file.token.symbol} ${file.token.address}, snapshot block ${file.proposal.snapshot_block}, ${file.votes.length} vote(s)\n`);

// 1. Signatures
let bad = 0;
for (const v of file.votes) {
  const signer = await recoverTypedDataAddress({
    domain: { name: "Palisec Mandates", version: "1", chainId: file.chain_id },
    types: { Vote: [{ name: "mandate", type: "string" }, { name: "proposalId", type: "string" }, { name: "choice", type: "uint8" }, { name: "snapshotBlock", type: "uint256" }] },
    primaryType: "Vote",
    message: { mandate: file.mandate.slug, proposalId: file.proposal.id, choice: CHOICES.indexOf(v.choice), snapshotBlock: BigInt(file.proposal.snapshot_block) },
    signature: v.signature,
  }).catch(() => null);
  const ok = signer && lc(signer) === lc(v.voter);
  if (!ok) bad++;
  console.log(`${ok ? "valid  " : "INVALID"} signature  ${v.voter}  ${v.choice}`);
}

// 2. Snapshot rebuilt from the chain
const c = createPublicClient({ transport: http(RPC) });
const ev = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const block = BigInt(file.proposal.snapshot_block);
const bal = new Map();
for (let from = BigInt(file.token.start_block); from <= block; from += STEP + 1n) {
  const to = from + STEP > block ? block : from + STEP;
  for (const l of await c.getLogs({ address: file.token.address, event: ev, fromBlock: from, toBlock: to })) {
    const f = lc(l.args.from), t = lc(l.args.to);
    if (f !== "0x0000000000000000000000000000000000000000") bal.set(f, (bal.get(f) ?? 0n) - l.args.value);
    if (t !== "0x0000000000000000000000000000000000000000") bal.set(t, (bal.get(t) ?? 0n) + l.args.value);
  }
}
let tableOk = true;
for (const [a, v] of Object.entries(file.holders_at_snapshot)) if ((bal.get(a) ?? 0n).toString() !== v) tableOk = false;
for (const [a, v] of bal) if (v !== 0n && file.holders_at_snapshot[a] !== v.toString()) tableOk = false;
let weightsOk = true;
for (const v of file.votes) {
  const chain = (bal.get(lc(v.voter)) ?? 0n).toString();
  const ok = chain === v.weight;
  if (!ok) weightsOk = false;
  console.log(`${ok ? "matches" : "DIFFERS"} chain balance  ${v.voter}  ${(Number(BigInt(chain) / 10n ** 14n) / 1e4).toLocaleString("en-US")} ${file.token.symbol}`);
}

// 3. Result
let f = 0n, a = 0n, ab = 0n;
for (const v of file.votes) {
  const w = BigInt(v.weight);
  if (v.choice === "for") f += w; else if (v.choice === "against") a += w; else ab += w;
}
const cast = f + a + ab, q = BigInt(file.mandate.rules.quorum);
const reached = cast >= q;
const passed = reached && f + a > 0n && f * 10000n > (f + a) * BigInt(file.mandate.rules.pass_bps);
const fmt = (x) => (Number(x / 10n ** 14n) / 1e4).toLocaleString("en-US");
const pub = file.proposal.result ?? {};
const same = pub.for === f.toString() && pub.against === a.toString() && pub.abstain === ab.toString() && pub.passed === passed;
console.log(`\nfor ${fmt(f)} · against ${fmt(a)} · abstain ${fmt(ab)} · cast ${fmt(cast)} · quorum ${fmt(q)} ${reached ? "reached" : "NOT reached"}`);
console.log(`Recounted result: ${passed ? "PASSED" : "NOT PASSED"} · published result: ${pub.passed === undefined ? "(still open)" : pub.passed ? "PASSED" : "NOT PASSED"}`);
console.log(`Snapshot table rebuilt from chain logs: ${tableOk ? "identical" : "DIFFERENT"}`);
const okAll = bad === 0 && weightsOk && tableOk && (pub.passed === undefined || same);
console.log(`\n${okAll ? "RECOUNT MATCHES" : "RECOUNT DOES NOT MATCH"}`);
process.exit(okAll ? 0 : 1);

#!/usr/bin/env node
// Mandate pages are public unless the server under test sets MANDATES_PUBLIC=0.
/**
 * Holder mandates end to end with the real $PALISEC token on a mainnet fork (no test tokens).
 * Start `anvil --fork-url https://rpc.mainnet.chain.robinhood.com --chain-id 4663` on 8545 and a test
 * server with RH_MAINNET_RPC_URL=http://127.0.0.1:8545 and 3-second delays, then:
 *
 *   BASE_URL=http://localhost:3003 RPC_URL=http://127.0.0.1:8545 node apps/web/scripts/e2e-mandates.mjs
 *
 * Voters get $PALISEC from the launch curve (impersonated on the fork). Decisions are dry runs.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:3003";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const PALISEC = "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB";
const CURVE = "0x9f7383a2fcb30124A203D359e7a403F750a56501";
const E18 = 10n ** 18n;
let passed = 0, failed = 0;
const check = (name, ok, detail) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { cookie, key, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}${path.startsWith("/m/") ? "" : "/api/v1"}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let b; try { b = JSON.parse(text); } catch { b = text; }
  return { status: res.status, body: b, headers: res.headers };
}
const chain = { id: 4663, name: "fork", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const ERC20 = parseAbi(["function transfer(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
async function give(to, amount) {
  await pub.request({ method: "anvil_impersonateAccount", params: [CURVE] });
  await pub.request({ method: "anvil_setBalance", params: [CURVE, "0xDE0B6B3A7640000"] });
  const w = createWalletClient({ account: CURVE, chain, transport: http(RPC) });
  const hash = await w.writeContract({ address: PALISEC, abi: ERC20, functionName: "transfer", args: [to, amount] });
  await pub.waitForTransactionReceipt({ hash });
}
const td = (chainId, slug, pid, choice, snap) => ({
  domain: { name: "Palisec Mandates", version: "1", chainId },
  types: { Vote: [{ name: "mandate", type: "string" }, { name: "proposalId", type: "string" }, { name: "choice", type: "uint8" }, { name: "snapshotBlock", type: "uint256" }] },
  primaryType: "Vote",
  message: { mandate: slug, proposalId: pid, choice: ["for", "against", "abstain"].indexOf(choice), snapshotBlock: BigInt(snap) },
});
const canonical = (v) => (Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v));

// ---------------------------------------------------------------- setup
const voters = [0, 1, 2, 3].map(() => privateKeyToAccount(generatePrivateKey()));
await give(voters[0].address, 600n * E18);
await give(voters[1].address, 400n * E18);
await give(voters[2].address, 200n * E18);
check("voters hold real $PALISEC on the fork (600 / 400 / 200)", (await pub.readContract({ address: PALISEC, abi: ERC20, functionName: "balanceOf", args: [voters[0].address] })) === 600n * E18);

const owner = privateKeyToAccount(generatePrivateKey());
const ch = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
const v = await call("POST", "/auth/verify", { body: { nonce: ch.body.nonce, signature: await owner.signMessage({ message: ch.body.message }) } });
const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
const ACCOUNT = privateKeyToAccount(generatePrivateKey()).address;
const RECIPIENT = privateKeyToAccount(generatePrivateKey()).address;
const p = await call("POST", "/policies", { cookie, body: { name: "Mandate e2e", policy_key: `mandate_e2e_${Date.now()}`, chain_id: 4663, account: ACCOUNT } });
const doc = {
  ...p.body.draft,
  asset_safety: { ...p.body.draft.asset_safety, enabled: false },
  limits: { ...p.body.draft.limits, max_transaction_value_wei: "100000000000000", hourly_budget_usd_micros: "1000000", max_price_age_seconds: 600, max_pending_operations: 20 },
  cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
  contracts: { default: "deny", allowlist: [{ address: RECIPIENT, selectors: [], require_verified_code: false }], denylist: [] },
  human_approval: { usd_threshold_micros: "1000000", require_for_unknown_methods: false },
};
const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
const ag = await call("POST", "/agents", { cookie, body: { name: "Mandate agent", chain_id: 4663, account: ACCOUNT, policy_id: p.body.id } });
const key = (await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: {} })).body.secret;
const dry = (wei) => call("POST", "/authorizations/evaluate", { key, body: { request_id: `m-${Date.now()}-${Math.random()}`, chain_id: 4663, to: RECIPIENT, value_wei: String(wei), data: "0x", gas_limit: 21000, deadline: Math.floor(Date.now() / 1000) + 120 } });

const envelope = { max_transaction_value_wei: "300000000000000", max_hourly_budget_usd_micros: "2000000", min_approval_threshold_usd_micros: "500000", allowed_contracts: [{ address: RECIPIENT, selectors: [] }] };
const slug = `e2e-${Date.now().toString(36)}`;
let r = await call("POST", "/mandates", { cookie, body: { slug, name: "E2E demo mandate", agent_id: ag.body.id, voting_period_seconds: 60, quorum: "1000", pass_bps: 5000, proposer_min: "1", envelope, demo: true } });
check("owner creates a mandate with an envelope", r.status === 201 && r.body.slug === slug, r.body);
const mid = r.body.id;

let lastProposalBody = null;
async function propose(change, title, proposer = voters[0]) {
  const nonce = `n${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const signature = await proposer.signTypedData({
    domain: { name: "Palisec Mandates", version: "1", chainId: 4663 },
    types: { Proposal: [{ name: "mandate", type: "string" }, { name: "title", type: "string" }, { name: "change", type: "string" }, { name: "nonce", type: "string" }] },
    primaryType: "Proposal",
    message: { mandate: slug, title, change: canonical(change), nonce },
  });
  lastProposalBody = { title, change, nonce, proposer: proposer.address, signature };
  return call("POST", `/public/mandates/${slug}/proposals`, { body: lastProposalBody });
}
const vote = async (acct, pid, snap, choice, override = {}) =>
  call("POST", `/public/mandates/${slug}/proposals/${pid}/votes`, { body: { voter: acct.address, choice, signature: await acct.signTypedData(td(4663, slug, pid, choice, snap)), ...override } });
const waitClose = async (closesAt) => {
  const ms = new Date(closesAt).getTime() - Date.now() + 1500;
  if (ms > 0) await sleep(ms);
  return call("GET", `/public/mandates/${slug}`);
};

// ---------------------------------------------------------------- envelope
r = await propose({ kind: "set_max_transaction_value", wei: "400000000000000" }, "Too far");
check("a proposal outside the envelope is rejected", r.status === 422, r.body);
r = await propose({ kind: "set_max_transaction_value", wei: "200000000000000" }, "Nobody", privateKeyToAccount(generatePrivateKey()));
check("a proposer without the minimum at the snapshot block is refused", r.status === 403, r.body);
r = await call("POST", `/mandates/${mid}/envelope`, { cookie, body: { envelope: { ...envelope, max_hourly_budget_usd_micros: "5000000" } } });
check("loosening the envelope is delayed (pending mandate_envelope)", r.body.pending_change?.kind === "mandate_envelope", r.body);
await sleep(3500);

// ---------------------------------------------------------------- proposal 1: loosening (per-tx 0.0001 -> 0.0003 ETH)
check("before the vote, 0.0002 ETH is beyond the policy (DENY)", (await dry("200000000000000")).body.decision === "DENY");
r = await propose({ kind: "set_max_transaction_value", wei: "300000000000000" }, "Raise per-transaction limit to 0.0003 ETH");
check("a holder opens a proposal (signed, snapshot fixed)", r.status === 201 && r.body.snapshot_block, r.body);
const p1 = r.body;
r = await call("POST", `/public/mandates/${slug}/proposals`, { body: lastProposalBody });
check("a signed proposal cannot be submitted twice (replay)", r.status === 409, r.body);
r = await propose({ kind: "remove_deny", address: RECIPIENT }, "Remove a deny rule");
check("a vote can never remove the owner's deny rules", r.status === 422, r.body);
await give(voters[3].address, 5000n * E18); // bought after the snapshot
await give(voters[2].address, 5000n * E18); // voter 3 buys more after the snapshot
r = await vote(voters[3], p1.proposal_id, p1.snapshot_block, "for");
check("tokens bought after the snapshot give no voting power", r.status === 403, r.body);
r = await vote(voters[0], p1.proposal_id, p1.snapshot_block, "for");
check("a valid signature counts with the snapshot balance (600)", r.status === 200 && r.body.weight === (600n * E18).toString(), r.body);
r = await call("POST", `/public/mandates/${slug}/proposals/${p1.proposal_id}/votes`, { body: { voter: voters[1].address, choice: "for", signature: "0x" + "11".repeat(65) } });
check("an invalid signature is rejected", r.status === 401, r.body);
r = await vote(voters[1], p1.proposal_id, p1.snapshot_block, "against", { choice: "for" });
check("a signature for a different choice is rejected", r.status === 401, r.body);
r = await call("POST", `/public/mandates/${slug}/proposals/${p1.proposal_id}/votes`, { body: { voter: voters[1].address, choice: "for", signature: await voters[1].signTypedData(td(4663, slug, "00000000-0000-0000-0000-000000000000", "for", p1.snapshot_block)) } });
check("a signature for another proposal is rejected", r.status === 401, r.body);
r = await vote(voters[1], p1.proposal_id, p1.snapshot_block, "for");
check("voter 2 votes for (400)", r.status === 200);
r = await vote(voters[2], p1.proposal_id, p1.snapshot_block, "for");
check("voter 3's weight is the snapshot balance (200), not today's", r.body.weight === (200n * E18).toString(), r.body);
r = await vote(voters[2], p1.proposal_id, p1.snapshot_block, "against");
check("a later vote from the same address replaces the earlier one", r.body.replaced_earlier_vote === true && r.body.choice === "against", r.body);
r = await waitClose(p1.closes_at);
let pr = r.body.proposals.find((x) => x.id === p1.proposal_id);
check("passed with quorum (1,000 for vs 200 against); loosening -> pending", pr.state === "passed" && pr.pending?.state === "pending", pr);
r = await vote(voters[1], p1.proposal_id, p1.snapshot_block, "against");
check("votes after close are rejected", r.status === 409, r.body);
check("while pending, the old limit still decides (0.0002 ETH DENY)", (await dry("200000000000000")).body.decision === "DENY");
await sleep(3500);
r = await call("GET", `/public/mandates/${slug}`);
pr = r.body.proposals.find((x) => x.id === p1.proposal_id);
check("after the delay it applies (active per-tx 0.0003 ETH)", r.body.active.max_transaction_value_wei === "300000000000000" && pr.pending.state === "applied", [r.body.active, pr.pending]);
r = await dry("200000000000000");
check("a request within the new mandate is allowed", r.body.decision === "ALLOW", r.body);
r = await dry("400000000000000");
check("a request beyond the mandate is denied (PS_BUDGET_001)", r.body.decision === "DENY" && r.body.reason_code === "PS_BUDGET_001", r.body);

// recount
const vf = await call("GET", `/public/mandates/${slug}/proposals/${p1.proposal_id}/vote-file`);
const path = join(tmpdir(), `vote-file-${slug}.json`);
writeFileSync(path, JSON.stringify(vf.body, null, 2));
const rc = spawnSync(process.execPath, [fileURLToPath(new URL("./recount-mandate.mjs", import.meta.url)), path, RPC], { encoding: "utf8" });
console.log(rc.stdout.split("\n").map((l) => `      ${l}`).join("\n"));
check("an independent recount from the published vote file matches", rc.status === 0 && /RECOUNT MATCHES/.test(rc.stdout));

// ---------------------------------------------------------------- proposal 2: tightening (0.0003 -> 0.00015 ETH)
r = await propose({ kind: "set_max_transaction_value", wei: "150000000000000" }, "Lower per-transaction limit to 0.00015 ETH");
const p2 = r.body;
await vote(voters[0], p2.proposal_id, p2.snapshot_block, "for");
await vote(voters[1], p2.proposal_id, p2.snapshot_block, "for");
r = await waitClose(p2.closes_at);
pr = r.body.proposals.find((x) => x.id === p2.proposal_id);
check("a passed tightening applies at once", pr.state === "passed" && pr.applied === "applied" && r.body.active.max_transaction_value_wei === "150000000000000", pr);
check("a request allowed before is now denied", (await dry("200000000000000")).body.decision === "DENY");

// ---------------------------------------------------------------- proposal 3: quorum edge (only 200 cast)
const small = privateKeyToAccount(generatePrivateKey());
await give(small.address, 200n * E18); // holds 200 before this snapshot: below the 1,000 quorum alone
r = await propose({ kind: "set_max_transaction_value", wei: "100000000000000" }, "Quorum edge");
const p3 = r.body;
await vote(small, p3.proposal_id, p3.snapshot_block, "for");
r = await waitClose(p3.closes_at);
pr = r.body.proposals.find((x) => x.id === p3.proposal_id);
check("below quorum -> rejected, nothing changes", pr.state === "rejected" && r.body.active.max_transaction_value_wei === "150000000000000", pr);

// ---------------------------------------------------------------- proposal 4: loosening cancelled (safety valve)
r = await propose({ kind: "set_max_transaction_value", wei: "300000000000000" }, "Raise again");
const p4 = r.body;
await vote(voters[0], p4.proposal_id, p4.snapshot_block, "for");
await vote(voters[1], p4.proposal_id, p4.snapshot_block, "for");
r = await waitClose(p4.closes_at);
r = await call("POST", `/mandates/${mid}/proposals/${p4.proposal_id}/cancel`, { cookie, body: { reason: "Testing the safety valve" } });
check("the owner cancels a pending loosening with a reason", r.status === 200 && r.body.state === "cancelled", r.body);
await sleep(3500);
r = await call("GET", `/public/mandates/${slug}`);
pr = r.body.proposals.find((x) => x.id === p4.proposal_id);
check("the cancel and its reason are on the public page; the limit never loosened", pr.pending.state === "cancelled" && /safety valve/.test(pr.pending.resolution) && r.body.active.max_transaction_value_wei === "150000000000000", pr.pending);

// ---------------------------------------------------------------- emergency stop overrides
await call("POST", "/organization/emergency-stop", { cookie, body: { active: true, confirm: true } });
r = await dry("100000000000000");
check("the emergency stop overrides an active mandate", r.body.decision === "DENY" && r.body.reason_code === "PS_PAUSED_001", r.body);
r = await call("GET", `/public/mandates/${slug}`);
check("the public page shows the emergency stop", r.body.emergency_stop === true);
await call("POST", "/organization/emergency-stop", { cookie, body: { active: false, confirm: true } });

// ---------------------------------------------------------------- public page
const page = await call("GET", `/m/${slug}`);
const html = String(page.body);
check("the public page works signed out and shows the demo label and real data", page.status === 200 && html.includes("Demo mandate") && html.includes(slug), page.status);
check("the public page leaks nothing private (no keys, emails or internal IDs of people)", !/ps_live_|ps_test_|@[a-z0-9-]+\.[a-z]{2,}|actor_user_id|org_id/i.test(html));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

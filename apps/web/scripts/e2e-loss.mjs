#!/usr/bin/env node
/**
 * Loss limits end to end against a test server: the loss limit (schema 1.3) with real Chainlink prices and
 * balances read from mainnet. Decisions only: nothing is signed or sent on chain. The account is the
 * Palisec demo smart account (read-only here); the exit address is its recovery owner.
 *
 *   BASE_URL=http://localhost:3002 node apps/web/scripts/e2e-loss.mjs   (test server with 3 s delays and the
 *   local webhook receiver origin http://127.0.0.1:4555)
 */
import { createServer } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const SAFE = "0x375BdF5DA6b7440889e50f13C894A3C4AC988329";
const EXIT = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430";
const TARGET = "0x000000000000000000000000000000000000dEaD";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 500)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { cookie, key, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

// Webhook receiver: the test server may deliver to http://127.0.0.1:4555.
const events = [];
const hooks = createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    try {
      events.push(JSON.parse(b));
    } catch {}
    res.writeHead(200).end("ok");
  });
}).listen(4555, "127.0.0.1");

const owner = privateKeyToAccount(generatePrivateKey());
const ch = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
const v = await call("POST", "/auth/verify", { body: { nonce: ch.body.nonce, signature: await owner.signMessage({ message: ch.body.message }) } });
const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
await call("POST", "/webhooks", { cookie, body: { url: "http://127.0.0.1:4555/hook", events: ["loss_limit.triggered", "loss_limit.reset_pending", "loss_limit.reset", "operation.denied"] } });

const p = await call("POST", "/policies", { cookie, body: { name: "loss", policy_key: `loss_e2e_${Date.now()}`, chain_id: 4663, account: SAFE } });
const LIMIT = {
  enabled: true, max_drawdown_bps: 0, max_loss_usd_micros: "50000", window_seconds: 86400, on_breach: "pause_risk", on_valuation_unavailable: "deny",
  stablecoins: [USDG], exit_addresses: [EXIT], max_exit_slippage_bps: 300, max_closed_market_price_age_seconds: 259200, reset_epoch: 0,
};
const base = {
  ...p.body.draft,
  schema_version: "1.3",
  token_spend: undefined, // new drafts carry token spend (schema 1.5); this test pins an older version
  asset_safety: { ...p.body.draft.asset_safety, enabled: false },
  limits: { ...p.body.draft.limits, max_transaction_value_wei: "1000000000000000", max_price_age_seconds: 600, hourly_budget_usd_micros: "100000000" },
  cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
  contracts: {
    default: "deny",
    allowlist: [
      { address: TARGET, selectors: [], require_verified_code: false },
      { address: EXIT, selectors: [], require_verified_code: false },
      { address: USDG, selectors: ["0xa9059cbb"], require_verified_code: false },
    ],
    denylist: [],
  },
  human_approval: { usd_threshold_micros: "999999999999", require_for_unknown_methods: false },
  loss_limit: LIMIT,
};
const activate = async (doc) => {
  const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
  return call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
};
let r = await activate(base);
check("a policy with a loss limit (schema 1.3) activates", r.status === 200 && r.body.state === "active", r.body);
const ag = await call("POST", "/agents", { cookie, body: { name: "Loss e2e", chain_id: 4663, account: SAFE, policy_id: p.body.id } });
const key = (await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: {} })).body.secret;
let n = 0;
const req = (to, value, data = "0x") => ({ request_id: `loss-${Date.now()}-${++n}`, chain_id: 4663, to, value_wei: value, data, gas_limit: 100000, deadline: Math.floor(Date.now() / 1000) + 120 });
const dry = (to, value, data) => call("POST", "/authorizations/evaluate", { key, body: req(to, value, data) });
const record = (to, value, data) => call("POST", "/operations", { key, body: req(to, value, data) });
const loss = (x) => x.body.checks?.find((c) => c.id === "loss");
const show = (label, x) => console.log(`      ${label}: ${x.body.decision} ${x.body.reason_code ?? ""} | ${loss(x)?.detail ?? x.body.message ?? JSON.stringify(x.body.error)}`);
const usdgTo = (to, amount) => "0xa9059cbb" + to.slice(2).toLowerCase().padStart(64, "0") + amount.toString(16).padStart(64, "0");

// 1) Within the limit.
r = await dry(TARGET, "10000000000");
show("tiny payment", r);
check("a payment far below the limit is allowed, with the loss after it", r.body.decision === "ALLOW" && /^Loss after this operation/.test(loss(r)?.detail ?? ""), r.body);
let st = await call("GET", `/agents/${ag.body.id}/loss-limit`, { cookie });
console.log(`      measured: value $${(Number(st.body.value_usd_micros) / 1e6).toFixed(4)}, peak $${(Number(st.body.peak_usd_micros) / 1e6).toFixed(4)} at ${st.body.measured_at}`);
check("status: measured from Chainlink, not paused", st.body.enabled === true && st.body.value_usd_micros !== null && st.body.paused === null, st.body);

// 2) The trade that would cross the limit is itself denied, and recording it pauses the account.
r = await dry(TARGET, "50000000000000");
show("payment of 0.00005 ETH to a third party (dry run)", r);
check("the operation that would cross the USD limit -> DENY PS_LOSS_002", r.body.decision === "DENY" && r.body.reason_code === "PS_LOSS_002", r.body);
r = await record(TARGET, "50000000000000");
check("recorded: DENY PS_LOSS_002, not retryable, nothing signed", r.body.decision === "DENY" && r.body.reason_code === "PS_LOSS_002" && r.body.retryable === false && !r.body.authorization_id, r.body);
check("the recorded denial carries a decision ID", typeof r.body.operation_id === "string", r.body);

// 3) Paused: every risk-adding operation is denied, risk-reducing ones are allowed.
r = await dry(TARGET, "10000000000");
show("tiny payment while paused", r);
check("while paused, even a tiny risk-adding payment -> DENY PS_LOSS_002", r.body.reason_code === "PS_LOSS_002" && /adds risk/.test(r.body.message), r.body);
r = await dry(EXIT, "50000000000000");
show("ETH back to the recovery owner", r);
check("while paused, ETH to the exit address is allowed (a withdrawal, not a loss)", r.body.decision === "ALLOW", r.body);
r = await dry(USDG, "0", usdgTo(EXIT, 100000n));
show("0.10 USDG back to the recovery owner", r);
check("while paused, USDG to the exit address is allowed", r.body.decision === "ALLOW", r.body);
st = await call("GET", `/agents/${ag.body.id}/loss-limit`, { cookie });
check("status: paused with PS_LOSS_002", st.body.paused === "PS_LOSS_002" && st.body.paused_at, st.body);
await sleep(1500);
check("webhook loss_limit.triggered delivered once", events.filter((e) => e.type === "loss_limit.triggered").length === 1, events.map((e) => e.type));

// Moving the paused agent onto a fresh copy of its policy must not clear the pause.
{
  const copy = await call("POST", "/policies", { cookie, body: { name: "copy", policy_key: `loss_copy_${Date.now()}`, chain_id: 4663, account: SAFE } });
  const sc = await call("PUT", `/policies/${copy.body.id}`, { cookie, body: { document: { ...base, policy_id: copy.body.policy_key } } });
  await call("POST", `/policies/${copy.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: sc.body.draft_hash } });
  const moved = await call("PATCH", `/agents/${ag.body.id}`, { cookie, body: { policy_id: copy.body.id } });
  r = await dry(TARGET, "10000000000");
  check("moving the paused agent to a fresh copy of its policy keeps it paused", r.body.reason_code === "PS_LOSS_002", { moved: moved.body.state ?? moved.status, r: r.body });
  await call("PATCH", `/agents/${ag.body.id}`, { cookie, body: { policy_id: p.body.id } });
  await sleep(4500); // a rebind may be a loosening (3 s test delay)
  r = await dry(TARGET, "10000000000");
  check("...and back on the original policy it is still paused", r.body.reason_code === "PS_LOSS_002", r.body);
}

// 4) Only the owner resets; the reset is a delayed loosening, cancellable, and then trading resumes.
r = await call("POST", `/agents/${ag.body.id}/loss-limit/reset`, { cookie, body: { confirm: true } });
check("reset requested: pending with an effective time (loosening delay)", r.body.state === "pending_activation" && r.body.effective_at, r.body);
st = await call("GET", `/agents/${ag.body.id}/loss-limit`, { cookie });
check("status shows the pending reset", st.body.reset_pending?.effective_at === r.body.effective_at, st.body);
r = await dry(TARGET, "10000000000");
check("before the reset applies, still denied", r.body.reason_code === "PS_LOSS_002", r.body);
await sleep(4500);
r = await dry(TARGET, "10000000000");
show("tiny payment after the reset", r);
check("after the reset applies, trading is allowed again (new window)", r.body.decision === "ALLOW", r.body);
st = await call("GET", `/agents/${ag.body.id}/loss-limit`, { cookie });
check("status: not paused, window restarted", st.body.paused === null && st.body.reset_epoch === 1, st.body);
await sleep(1500);
check("webhooks loss_limit.reset_pending and loss_limit.reset delivered", ["loss_limit.reset_pending", "loss_limit.reset"].every((t) => events.some((e) => e.type === t)), events.map((e) => e.type));
const trig = events.find((e) => e.type === "loss_limit.triggered");
check("the triggered event names the code and the limit", trig?.data?.reason_code === "PS_LOSS_002" && trig?.data?.max_loss_usd_micros === "50000", trig);

// 5) Lowering the limit is instant; raising it waits.
r = await activate({ ...base, loss_limit: { ...LIMIT, reset_epoch: 1, max_loss_usd_micros: "40000" } });
check("lowering the limit applies at once (tightening)", r.body.state === "active", r.body);
r = await activate({ ...base, loss_limit: { ...LIMIT, reset_epoch: 1, max_loss_usd_micros: "90000" } });
check("raising the limit waits (loosening)", r.body.state === "pending_activation", r.body);
await call("POST", `/policies/${p.body.id}/pending/cancel`, { cookie, body: { confirm: true } });

// 6) Schema: a loss limit needs 1.3 and at least one limit.
r = await activate({ ...base, schema_version: "1.2", token_spend: undefined });
check("loss_limit on schema 1.2 is rejected", r.status === 422, r.body);
r = await activate({ ...base, loss_limit: { ...LIMIT, max_loss_usd_micros: "0" } });
check("a loss limit with no limit set is rejected", r.status === 422, r.body);

// 7) Isolation: another organization's policy on the same account cannot pause this one.
{
  const other = privateKeyToAccount(generatePrivateKey());
  const c2 = await call("POST", "/auth/challenges", { body: { address: other.address, chain_id: 4663 } });
  const v2 = await call("POST", "/auth/verify", { body: { nonce: c2.body.nonce, signature: await other.signMessage({ message: c2.body.message }) } });
  const ck = (v2.headers.get("set-cookie") ?? "").split(";")[0];
  const p2 = await call("POST", "/policies", { cookie: ck, body: { name: "other", policy_key: `loss_other_${Date.now()}`, chain_id: 4663, account: SAFE } });
  const s2 = await call("PUT", `/policies/${p2.body.id}`, { cookie: ck, body: { document: { ...base, policy_id: p2.body.policy_key, loss_limit: { ...LIMIT, max_loss_usd_micros: "1" } } } });
  await call("POST", `/policies/${p2.body.id}/activate`, { cookie: ck, body: { confirm: true, draft_hash: s2.body.draft_hash } });
  const a2 = await call("POST", "/agents", { cookie: ck, body: { name: "Other org", chain_id: 4663, account: SAFE, policy_id: p2.body.id } });
  const k2 = (await call("POST", `/agents/${a2.body.id}/credentials`, { cookie: ck, body: {} })).body.secret;
  r = await call("POST", "/operations", { key: k2, body: req(TARGET, "50000000000000") });
  check("another organization breaches its own limit on the same account", r.body.reason_code === "PS_LOSS_002", r.body);
  r = await dry(TARGET, "10000000000");
  check("...and this organization's agent on that account is not paused", r.body.decision === "ALLOW", r.body);
}

// 8) The hourly keeper answers with counts only.
r = await call("POST", "/public/loss/snapshot");
check("keeper: counts only, no addresses", r.status === 200 && Object.keys(r.body).sort().join() === "accounts,measured,paused,unavailable", r.body);

hooks.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

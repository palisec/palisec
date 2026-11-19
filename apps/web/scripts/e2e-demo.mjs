#!/usr/bin/env node
/**
 * Phase 3 Part 2: the homepage's Live API demo (POST /api/demo/evaluate) against a running deployment
 * with a database. Two steps, because the server reads the demo key from its environment at start:
 *
 *   BASE_URL=http://localhost:3002 node scripts/e2e-demo.mjs setup > <state file outside the repo>
 *     signs in with a throwaway wallet, creates the demo policy (DEMO_POLICY below) on testnet, an agent
 *     and an evaluate-only key, and prints them as JSON (a local test key, never a production one)
 *   start the server with PALISEC_DEMO_API_KEY=<key from the state file>, logging to LOG_FILE, then
 *   BASE_URL=… STATE_FILE=… LOG_FILE=… [DOWN_URL=<same build, database unreachable>] node scripts/e2e-demo.mjs test
 *
 * The browser side of the comparison is the evaluator the homepage runs (bundled in @palisec/sdk/policy).
 */
import { readFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { EMPTY_STATE, EXAMPLE_ENV, EXAMPLE_POLICY, SCENARIOS, SIM_EPOCH, evaluate } from "../../../packages/sdk/dist/policy.js";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const ORIGIN = new URL(BASE).origin;
const TESTNET = 46630;

/**
 * The demo organization's policy: the homepage's example policy on testnet, with two differences the
 * live inputs need (the browser uses fixed example inputs, the server live ones):
 *  - require_verified_code false: the example contracts have no code on testnet;
 *  - approval above $100 instead of $150: the browser prices ETH at $3,200, the server at the live
 *    price, so the two examples either side of the threshold (0.04 and 0.08 ETH) land on the same side
 *    in both modes while ETH is between about $1,250 and $2,450.
 */
export const demoPolicy = (account) => ({
  ...EXAMPLE_POLICY,
  policy_id: "live_api_demo",
  version: 1,
  status: "draft",
  account: { chain_id: TESTNET, address: account },
  contracts: { ...EXAMPLE_POLICY.contracts, allowlist: EXAMPLE_POLICY.contracts.allowlist.map((e) => ({ ...e, require_verified_code: false })) },
  human_approval: { ...EXAMPLE_POLICY.human_approval, usd_threshold_micros: "100000000" },
});

async function call(method, path, { cookie, key, body, origin = ORIGIN, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  if (origin) h.origin = origin;
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: json, headers: res.headers, text };
}

if (process.argv[2] === "setup") {
  const ownerKey = generatePrivateKey();
  const owner = privateKeyToAccount(ownerKey);
  const account = privateKeyToAccount(generatePrivateKey()).address;
  const c = await call("POST", "/api/v1/auth/challenges", { body: { address: owner.address, chain_id: TESTNET } });
  const v = await call("POST", "/api/v1/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
  const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
  const fail = (what, r) => {
    console.error(`setup failed at ${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    process.exit(1);
  };
  let r = await call("POST", "/api/v1/policies", { cookie, body: { name: "Live API demo", policy_key: "live_api_demo", chain_id: TESTNET, account } });
  if (r.status !== 201) fail("policy", r);
  const policyId = r.body.id;
  r = await call("PUT", `/api/v1/policies/${policyId}`, { cookie, body: { document: demoPolicy(account) } });
  if (r.status !== 200 || r.body.draft_errors.length) fail("draft", r);
  r = await call("POST", `/api/v1/policies/${policyId}/activate`, { cookie, body: { confirm: true, draft_hash: r.body.draft_hash } });
  if (r.status !== 200) fail("activate", r);
  r = await call("POST", "/api/v1/agents", { cookie, body: { name: "Homepage live demo", chain_id: TESTNET, account, policy_id: policyId } });
  if (r.status !== 201) fail("agent", r);
  const agentId = r.body.id;
  r = await call("POST", `/api/v1/agents/${agentId}/credentials`, { cookie, body: { label: "homepage demo", scopes: ["authorizations:evaluate"] } });
  if (r.status !== 201) fail("key", r);
  const demoKey = r.body.secret;
  const credentialId = r.body.id;
  r = await call("POST", `/api/v1/agents/${agentId}/credentials`, { cookie, body: { label: "full" } });
  // ownerKey: the throwaway test wallet (local state file only), so the test step can sign in again
  // after the session expires instead of reading the console with a dead cookie.
  console.log(JSON.stringify({ cookie, ownerKey, policyId, agentId, credentialId, demoKey, fullKey: r.body.secret }));
  process.exit(0);
}

const S = JSON.parse(readFileSync(process.env.STATE_FILE, "utf8"));
// Sessions expire: sign in again with the setup's test wallet when the state file has it.
if (S.ownerKey) {
  const owner = privateKeyToAccount(S.ownerKey);
  const c = await call("POST", "/api/v1/auth/challenges", { body: { address: owner.address, chain_id: TESTNET } });
  const v = await call("POST", "/api/v1/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
  S.cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
}
if ((await call("GET", "/api/v1/me", { cookie: S.cookie })).status !== 200) {
  console.error("The state file's session has expired and it has no ownerKey: run the setup step again.");
  process.exit(2);
}
let passed = 0;
let failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) passed++;
  else failed++;
  results.push([name, Boolean(cond)]);
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 400)}`}`);
}
// Each block uses its own client address so the per-IP limit (10/min) never mixes test groups.
let ipSeq = 1;
const freshIp = () => ({ "x-real-ip": `203.0.113.${ipSeq++}` });
const demo = (body, opts = {}) => call("POST", "/api/demo/evaluate", { body, ...opts });
const operationsCount = async () => (await call("GET", `/api/v1/operations?agent_id=${S.agentId}`, { cookie: S.cookie })).body;

// One real operation with the full key (an ID for the refusal checks), recorded before the snapshot.
const intent = { request_id: `e2e_${Date.now()}`, chain_id: TESTNET, to: EXAMPLE_POLICY.contracts.allowlist[0].address, value_wei: "0", data: "0x", gas_limit: 100000, deadline: Math.floor(Date.now() / 1000) + 120 };
const fullOp = await call("POST", "/api/v1/operations", { key: S.fullKey, body: { ...intent, request_id: `e2e_full_${Date.now()}` }, origin: null });
const opId = fullOp.body.operation_id;
const summary = async () => (await call("GET", "/api/v1/summary", { cookie: S.cookie })).body;
const before = await operationsCount();
const summaryBefore = await summary();

// ---------------------------------------------------------------- real response, request ID in the logs
let ip = freshIp();
let r = await demo({ scenario: "swap" }, { headers: ip });
check("Live mode returns the server's decision with every check", r.status === 200 && r.body.response?.decision === "ALLOW" && r.body.response?.dry_run === true && r.body.response?.checks?.length > 5, r.body);
check("response carries the API request ID and the server time", /^ps_req_[0-9a-f]{32}$/.test(r.body.api_request_id ?? "") && !Number.isNaN(Date.parse(r.body.server_time)), r.body);
check("response is on testnet", r.body.chain_id === TESTNET, r.body);
if (process.env.LOG_FILE) {
  await new Promise((res) => setTimeout(res, 500));
  const log = readFileSync(process.env.LOG_FILE, "utf8");
  check("the request ID appears in the server log (demo.evaluate)", log.split("\n").some((l) => l.includes('"demo.evaluate"') && l.includes(r.body.api_request_id)), r.body.api_request_id);
}

// ---------------------------------------------------------------- expected decisions, same as the browser
const EXPECTED = { "token-transfer": "ALLOW", swap: "ALLOW", "large-swap": "REQUIRES_HUMAN_SIGNATURE", "over-limit": "DENY", "unknown-method": "REQUIRES_HUMAN_SIGNATURE", "unknown-target": "DENY", "denied-target": "DENY" };
for (const s of SCENARIOS) {
  // The browser workbench: default policy, empty ledger, fixed example inputs.
  const browser = evaluate(EXAMPLE_POLICY, { ...s.intent, request_id: "ps_req_sim_0001", deadline: SIM_EPOCH + 120 }, EMPTY_STATE, EXAMPLE_ENV);
  if (ipSeq % 8 === 0) ip = freshIp();
  r = await demo({ scenario: s.id }, { headers: freshIp() });
  const live = r.body.response ?? {};
  check(`${s.id}: server returns ${EXPECTED[s.id]}`, r.status === 200 && live.decision === EXPECTED[s.id], live);
  check(`${s.id}: browser and Live give the same decision and reason code (${browser.decision} ${browser.reason_code ?? ""})`, live.decision === browser.decision && (live.reason_code ?? null) === (browser.reason_code ?? null), { browser: [browser.decision, browser.reason_code], live: [live.decision, live.reason_code] });
}

// ---------------------------------------------------------------- the demo key can only evaluate
r = await call("POST", "/api/v1/authorizations/evaluate", { key: S.demoKey, body: intent, origin: null });
check("demo key: dry run allowed", r.status === 200 && r.body.dry_run === true, r.body);
r = await call("POST", "/api/v1/operations", { key: S.demoKey, body: intent, origin: null });
check("demo key refused on POST /v1/operations", r.status === 403 && r.body.error?.code === "PS_AUTH_001", r.body);
for (const [m, p] of [
  ["GET", `/api/v1/operations/${opId}`],
  ["POST", `/api/v1/operations/${opId}/cancel`],
  ["POST", `/api/v1/operations/${opId}/user-operation`],
  ["POST", `/api/v1/operations/${opId}/submit`],
  ["GET", "/api/v1/integration/operations"],
  ["GET", "/api/v1/integration/policy"],
  ["GET", "/api/v1/integration/audit-events"],
])
  check(`demo key refused on ${m} ${p.replace(opId, "{id}")}`, [401, 403].includes((r = await call(m, p, { key: S.demoKey, body: m === "POST" ? {} : undefined, origin: null })).status), r.body);
for (const [m, p] of [
  ["GET", "/api/v1/approvals"],
  ["POST", `/api/v1/approvals/${opId}/approve`],
  ["POST", `/api/v1/agents/${S.agentId}/credentials`],
  ["POST", `/api/v1/credentials/${S.credentialId}/rotate`],
  ["POST", `/api/v1/credentials/${S.credentialId}/revoke`],
  ["GET", "/api/v1/agents"],
])
  check(`demo key refused on ${m} ${p.replace(opId, "{id}").replace(S.agentId, "{agent}").replace(S.credentialId, "{key}")} (members only)`, (r = await call(m, p, { key: S.demoKey, body: m === "POST" ? {} : undefined })).status >= 400 && r.status !== 404 && !JSON.stringify(r.body).includes(S.demoKey) && r.body.error !== undefined, [r.status, r.body]);
r = await call("POST", "/api/mcp", { key: S.demoKey, body: { jsonrpc: "2.0", id: 1, method: "tools/list" }, headers: { accept: "application/json, text/event-stream" }, origin: null });
check("demo key refused on the MCP server", [401, 403].includes(r.status), [r.status, r.text.slice(0, 200)]);

// ---------------------------------------------------------------- no key in the page, the bundle or the responses
const page = await call("GET", "/", { origin: null });
const scripts = [...page.text.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]);
let bundle = "";
for (const s of scripts) bundle += await (await fetch(`${BASE}${s}`)).text();
const KEY_SHAPE = /ps_(?:live|test)_[0-9a-f]{48}/;
check(`no key in the homepage HTML or its ${scripts.length} script files`, scripts.length > 0 && !page.text.includes(S.demoKey) && !bundle.includes(S.demoKey) && !KEY_SHAPE.test(page.text) && !KEY_SHAPE.test(bundle));
check("the workbench's Live API code is in the bundle (the check above covered it)", bundle.includes("/api/demo/evaluate"));
r = await demo({ scenario: "swap" }, { headers: freshIp() });
check("no key in the demo route's response or headers", !r.text.includes(S.demoKey) && !KEY_SHAPE.test(r.text) && ![...r.headers.values()].some((v) => KEY_SHAPE.test(v)));

// ---------------------------------------------------------------- rate limit and input validation
ip = freshIp();
const codes = [];
for (let i = 0; i < 11; i++) codes.push((await demo({ scenario: "token-transfer" }, { headers: ip })).status);
check("rate limit: 10 per minute per address, then 429", codes.slice(0, 10).every((c) => c === 200) && codes[10] === 429, codes);
r = await demo({ scenario: "token-transfer" }, { headers: ip });
check("429 carries Retry-After", r.status === 429 && r.headers.get("retry-after") === "60", [r.status, r.headers.get("retry-after")]);
for (const [name, body] of [
  ["unknown scenario", { scenario: "drain-everything" }],
  ["missing scenario", {}],
  ["extra field (no free-form input)", { scenario: "swap", to: "0x0000000000000000000000000000000000000001" }],
  ["non-JSON body", "not json"],
  ["array body", [1, 2]],
  ["body over 1 KB", { scenario: "swap", pad: "x".repeat(2000) }],
])
  check(`bad input is a 400: ${name}`, (r = await demo(body, { headers: freshIp() })).status === 400 && r.body.error?.code === "PS_REQUEST_001", [r.status, r.body]);
r = await demo({ scenario: "swap" }, { headers: freshIp(), origin: null });
check("another site cannot use the route (no Origin → 403)", r.status === 403, r.body);
r = await demo({ scenario: "swap" }, { headers: freshIp(), origin: "https://evil.example" });
check("another site cannot use the route (foreign Origin → 403)", r.status === 403, r.body);
check("GET is not allowed", [405].includes((await call("GET", "/api/demo/evaluate")).status));

// ---------------------------------------------------------------- nothing reserved or recorded
const after = await operationsCount();
const n = (x) => (Array.isArray(x?.operations) ? x.operations.length : -1);
check("no operation recorded by any Live run", n(before) >= 1 && n(after) === n(before), { before: n(before), after: n(after) });
const summaryAfter = await summary();
check(
  "no budget reserved and no decision counted by Live runs (dashboard summary unchanged)",
  typeof summaryBefore?.allowed === "number" &&
    summaryAfter.reserved_last_hour_usd_micros === summaryBefore.reserved_last_hour_usd_micros && summaryAfter.allowed === summaryBefore.allowed && summaryAfter.denied === summaryBefore.denied && summaryAfter.reviewed === summaryBefore.reviewed,
  { summaryBefore, summaryAfter },
);

// ---------------------------------------------------------------- API down → an error, not a result
if (process.env.DOWN_URL) {
  const res = await fetch(`${process.env.DOWN_URL}/api/demo/evaluate`, { method: "POST", headers: { "content-type": "application/json", origin: new URL(process.env.DOWN_URL).origin }, body: JSON.stringify({ scenario: "swap" }) });
  const body = await res.json().catch(() => null);
  check("API down: non-200 with an error and no decision", res.status >= 500 && !body?.response?.decision && (body?.response?.error?.code ?? body?.error?.code) === "PS_STATE_001", [res.status, body]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (process.env.RESULTS_FILE) (await import("node:fs")).writeFileSync(process.env.RESULTS_FILE, JSON.stringify(results));
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
/**
 * Hostile-input suite: malformed, oversized, ambiguous and forged requests against a live server.
 *   BASE_URL=http://localhost:3000 node apps/web/scripts/adversarial.mjs
 *
 * Invariants checked on every response: never a 5xx for client mistakes, always the JSON error
 * envelope with a stable code, no stack traces or file paths, the API key never echoed, and
 * security headers present. The rate-limit burst runs last because it exhausts the key's budget.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`);
};

const LEAK = /(\bat [\w.<>]+ \(|node_modules|\.ts:\d+|\.js:\d+|postgres|syntax error|stack)/i;
let KEY = "";

async function raw(method, path, { headers = {}, body, cookie } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  const init = { method, headers: h };
  if (body !== undefined) {
    init.body = body;
    if (body instanceof ReadableStream) init.duplex = "half";
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json, headers: res.headers };
}

/** A refusal: the given status, the error envelope with a PS_ code, nothing leaked. */
function refused(name, r, status, code) {
  const env = r.json?.error;
  const okStatus = Array.isArray(status) ? status.includes(r.status) : r.status === status;
  const clean = !LEAK.test(r.text) && (!KEY || !r.text.includes(KEY));
  check(name, okStatus && typeof env?.code === "string" && env.code.startsWith("PS_") && (!code || env.code === code) && clean && Boolean(r.json?.request_id), {
    status: r.status,
    body: r.text.slice(0, 200),
  });
}

const json = (o) => JSON.stringify(o);
const agentHeaders = (extra = {}) => ({ authorization: `Bearer ${KEY}`, "content-type": "application/json", ...extra });

// ---- setup: owner, active policy, agent, key ---------------------------------------------------
async function api(method, path, { cookie, body } = {}) {
  const headers = { origin: BASE };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : json(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}
const owner = privateKeyToAccount(generatePrivateKey());
const agentAcct = privateKeyToAccount(generatePrivateKey());
const token = privateKeyToAccount(generatePrivateKey()).address;
const c = await api("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 46630 } });
const v = await api("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
const p = await api("POST", "/policies", { cookie, body: { name: "Adversarial", policy_key: "adv_test", chain_id: 46630, account: agentAcct.address } });
const draft = { ...p.body.draft, contracts: { default: "deny", allowlist: [{ address: token, selectors: ["0xa9059cbb"], require_verified_code: false }], denylist: [] } };
const saved = await api("PUT", `/policies/${p.body.id}`, { cookie, body: { document: draft } });
await api("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } });
const a = await api("POST", "/agents", { cookie, body: { name: "Adversarial agent", chain_id: 46630, account: agentAcct.address, policy_id: p.body.id } });
KEY = (await api("POST", `/agents/${a.body.id}/credentials`, { cookie, body: { label: "adv" } })).body.secret ?? "";
check("setup: agent key issued", /^ps_test_[0-9a-f]{48}$/.test(KEY));

const now = () => Math.floor(Date.now() / 1000);
const intent = (over = {}) => ({ request_id: `adv-${crypto.randomUUID()}`, chain_id: 46630, to: token, value_wei: "0", data: "0x", gas_limit: 21000, deadline: now() + 60, ...over });
const op = (body, headers) => raw("POST", "/api/v1/authorizations/evaluate", { headers: agentHeaders(headers), body });

// ---- malformed bodies --------------------------------------------------------------------------
refused("malformed JSON", await op("{"), 400, "PS_REQUEST_001");
refused("JSON array body", await op("[]"), 400, "PS_REQUEST_001");
refused("JSON null body", await op("null"), 400, "PS_REQUEST_001");
refused("empty body", await op(""), 400, "PS_REQUEST_001");
refused("oversized body (64 KB)", await op(json({ ...intent(), pad: "x".repeat(64 * 1024) })), [400, 413], "PS_REQUEST_001");
refused(
  "oversized multibyte body under the character limit",
  await op(json({ ...intent(), pad: "€".repeat(7000) })),
  [400, 413],
  "PS_REQUEST_001",
);
{
  const chunks = 64;
  const stream = new ReadableStream({
    pull(ctrl) {
      if (this.n === undefined) this.n = 0;
      if (this.n++ >= chunks) return ctrl.close();
      ctrl.enqueue(new TextEncoder().encode(this.n === 1 ? '{"pad":"' : "y".repeat(1024)));
    },
  });
  refused("oversized chunked body without Content-Length", await op(stream), [400, 413], "PS_REQUEST_001");
}
refused("__proto__ key is an unknown field", await op('{"__proto__":{"admin":true},' + json(intent()).slice(1)), 400, "PS_REQUEST_001");
refused("constructor key is an unknown field", await op(json({ ...intent(), constructor: { prototype: {} } })), 400, "PS_REQUEST_001");

// ---- hostile field values ----------------------------------------------------------------------
const bad = [
  ["NUL in request_id", { request_id: "a\u0000b" }],
  ["SQL in request_id", { request_id: "x'; DROP TABLE operations;--" }],
  ["request_id of 129 characters", { request_id: "r".repeat(129) }],
  ["emoji request_id", { request_id: "req-😀" }],
  ["value_wei of 79 digits", { value_wei: "1" + "0".repeat(78) }],
  ["negative value_wei", { value_wei: "-1" }],
  ["value_wei in exponent form", { value_wei: "1e18" }],
  ["value_wei as a number", { value_wei: 1000 }],
  ["gas_limit as a string", { gas_limit: "21000" }],
  ["fractional gas_limit", { gas_limit: 21000.5 }],
  ["gas_limit above the ceiling", { gas_limit: 30_000_001 }],
  ["deadline far in the future", { deadline: now() + 10 ** 9 }],
  ["fractional deadline", { deadline: now() + 0.5 }],
  ["chain_id as a string", { chain_id: "46630" }],
  ["odd-length calldata", { data: "0xabc" }],
  ["calldata without 0x", { data: "a9059cbb" }],
  ["target that is not an address", { to: "0x1234" }],
  ["target with a bad checksum", { to: token.slice(0, 2) + token.slice(2).replace(/[a-f]/, (x) => x.toUpperCase()).replace(/[A-F](?=[^A-F]*$)/, (x) => x.toLowerCase()) }],
];
for (const [name, over] of bad) {
  const r = await op(json(intent(over)));
  if (name === "target with a bad checksum") {
    // A mixed-case address whose checksum is wrong is either refused or normalized; never a 5xx.
    check(name, r.status < 500 && !LEAK.test(r.text), { status: r.status, body: r.text.slice(0, 200) });
  } else refused(name, r, 400, "PS_REQUEST_001");
}

// ---- authentication edge cases -----------------------------------------------------------------
const authCases = [
  ["no Authorization header", {}],
  ["lowercase bearer scheme", { authorization: `bearer ${KEY}` }],
  ["Basic scheme", { authorization: `Basic ${Buffer.from(`x:${KEY}`).toString("base64")}` }],
  ["key with a different last character", { authorization: `Bearer ${KEY.slice(0, -1)}${KEY.endsWith("0") ? "1" : "0"}` }],
  ["key with trailing junk", { authorization: `Bearer ${KEY}x` }],
  ["two keys in one header", { authorization: `Bearer ${KEY}, Bearer ${KEY}` }],
  ["old-format key prefix", { authorization: `Bearer rw_test_${KEY.slice(8)}` }],
];
const authBodies = new Set();
for (const [name, h] of authCases) {
  const r = await raw("POST", "/api/v1/authorizations/evaluate", { headers: { "content-type": "application/json", ...h }, body: json(intent()) });
  refused(`auth: ${name}`, r, 401, "PS_AUTH_001");
  authBodies.add(r.json?.error?.message);
}
check("auth: every failure gives the same message (no key oracle)", authBodies.size === 1, [...authBodies]);
refused(
  "auth: API key in the query string is not accepted",
  await raw("POST", `/api/v1/authorizations/evaluate?api_key=${KEY}`, { headers: { "content-type": "application/json" }, body: json(intent()) }),
  401,
  "PS_AUTH_001",
);
{
  const r = await raw("POST", "/api/v1/authorizations/evaluate", { headers: agentHeaders({ "idempotency-key": "k".repeat(2000) }), body: json(intent()) });
  check("oversized Idempotency-Key is refused or ignored, never a 5xx", r.status < 500 && !LEAK.test(r.text), r.status);
}
{
  const r = await raw("POST", "/api/v1/operations", { headers: agentHeaders({ "idempotency-key": "bad keyé" }), body: json(intent()) });
  check("non-ASCII Idempotency-Key is refused or accepted, never a 5xx", r.status < 500, r.status);
}

// ---- paths and methods -------------------------------------------------------------------------
for (const [name, path] of [
  ["non-UUID operation id", "/api/v1/operations/not-a-uuid"],
  ["path traversal in id", "/api/v1/operations/..%2f..%2fagents"],
  ["NUL in id", "/api/v1/operations/%00"],
  ["unknown UUID", `/api/v1/operations/${crypto.randomUUID()}`],
]) {
  const r = await raw("GET", path, { headers: agentHeaders() });
  refused(`paths: ${name}`, r, [400, 404], undefined);
}
{
  const r = await raw("DELETE", "/api/v1/operations", { headers: agentHeaders() });
  check("methods: DELETE on a collection is 405", r.status === 405, r.status);
}

// ---- console (cookie) routes -------------------------------------------------------------------
const consolePost = (path, body, headers = {}) =>
  raw("POST", `/api/v1${path}`, { cookie, headers: { "content-type": "application/json", origin: BASE, ...headers }, body: json(body) });
refused("CSRF: foreign Origin", await consolePost("/agents", { name: "x", chain_id: 46630, account: agentAcct.address, policy_id: p.body.id }, { origin: "https://evil.example" }), 403);
refused("CSRF: Origin null", await consolePost("/agents", { name: "x", chain_id: 46630, account: agentAcct.address, policy_id: p.body.id }, { origin: "null" }), 403);
refused(
  "CSRF: look-alike host",
  await consolePost("/agents", { name: "x", chain_id: 46630, account: agentAcct.address, policy_id: p.body.id }, { origin: `${BASE}.evil.example` }),
  403,
);
{
  const forged = cookie.replace(/=(.*)$/, (_, v) => `=${v.slice(0, -2)}${v.endsWith("a") ? "bb" : "aa"}`);
  refused("session: tampered cookie", await raw("GET", "/api/v1/agents", { cookie: forged }), 401, "PS_AUTH_001");
  refused("session: SQL in cookie", await raw("GET", "/api/v1/agents", { cookie: `${cookie.split("=")[0]}=' OR '1'='1` }), 401, "PS_AUTH_001");
}
for (const [name, body] of [
  ["NUL in agent name", { name: "evil\u0000name", chain_id: 46630, account: agentAcct.address, policy_id: p.body.id }],
  ["agent name of 10 000 characters", { name: "n".repeat(10_000), chain_id: 46630, account: agentAcct.address, policy_id: p.body.id }],
  ["lone surrogate in agent name", { name: "bad\ud800", chain_id: 46630, account: agentAcct.address, policy_id: p.body.id }],
]) {
  refused(`console: ${name}`, await consolePost("/agents", body), 400, "PS_REQUEST_001");
}
refused("console: NUL in key label", await consolePost(`/agents/${a.body.id}/credentials`, { label: "a\u0000b" }), 400, "PS_REQUEST_001");
refused("console: NUL in policy name", await consolePost("/policies", { name: "p\u0000", policy_key: "adv_nul", chain_id: 46630, account: agentAcct.address }), 400, "PS_REQUEST_001");
{
  const html = "<script>alert(1)</script>";
  const r = await consolePost("/agents", { name: html, chain_id: 46630, account: agentAcct.address, policy_id: p.body.id });
  const back = await raw("GET", `/api/v1/agents/${r.json?.id}`, { cookie });
  check("console: HTML in a name is stored and returned as plain text", r.status === 201 && back.json?.name === html && back.headers.get("content-type")?.includes("application/json"), [r.status, back.json?.name]);
}
{
  let deep = "0";
  for (let i = 0; i < 3000; i++) deep = `[${deep}]`;
  const r = await raw("PUT", `/api/v1/policies/${p.body.id}`, { cookie, headers: { "content-type": "application/json", origin: BASE }, body: `{"document":{"x":${deep}}}` });
  check("console: deeply nested JSON is handled without a 5xx", r.status < 500 && !LEAK.test(r.text), { status: r.status, body: r.text.slice(0, 120) });
}

// ---- sign-in -----------------------------------------------------------------------------------
refused("sign-in: challenge for a non-address", await raw("POST", "/api/v1/auth/challenges", { headers: { "content-type": "application/json", origin: BASE }, body: json({ address: "0x12", chain_id: 46630 }) }), 400);
refused(
  "sign-in: garbage signature",
  await raw("POST", "/api/v1/auth/verify", { headers: { "content-type": "application/json", origin: BASE }, body: json({ nonce: c.body.nonce, signature: "0x" + "00".repeat(65) }) }),
  [400, 401],
);
refused(
  "sign-in: unknown nonce",
  await raw("POST", "/api/v1/auth/verify", { headers: { "content-type": "application/json", origin: BASE }, body: json({ nonce: "nope", signature: "0x00" }) }),
  [400, 401],
);
{
  // A challenge signed once cannot sign in twice.
  const c2 = await api("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 46630 } });
  const sig = await owner.signMessage({ message: c2.body.message });
  const first = await api("POST", "/auth/verify", { body: { nonce: c2.body.nonce, signature: sig } });
  const again = await raw("POST", "/api/v1/auth/verify", { headers: { "content-type": "application/json", origin: BASE }, body: json({ nonce: c2.body.nonce, signature: sig }) });
  check("sign-in: a challenge cannot be replayed", first.status === 200 && again.status >= 400 && again.status < 500, [first.status, again.status]);
}

// ---- headers -----------------------------------------------------------------------------------
for (const path of ["/", "/api/v1/health", "/console"]) {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const h = r.headers;
  const csp = h.get("content-security-policy") ?? "";
  check(
    `headers: ${path} sends CSP, nosniff, HSTS, frame-ancestors none, no X-Powered-By`,
    csp.includes("frame-ancestors 'none'") && h.get("x-content-type-options") === "nosniff" && Boolean(h.get("strict-transport-security")) && !h.get("x-powered-by"),
    Object.fromEntries(h),
  );
}
{
  const r = await raw("GET", "/api/v1/health");
  check("headers: API responses are not cacheable", (r.headers.get("cache-control") ?? "").includes("no-store"), r.headers.get("cache-control"));
  check("headers: every API response carries X-Request-Id", /^ps_req_[0-9a-f]{32}$/.test(r.headers.get("x-request-id") ?? ""), r.headers.get("x-request-id"));
}
{
  const r = await op("{");
  check("errors: X-Request-Id matches the error body's request_id", r.headers.get("x-request-id") === r.json?.request_id, [r.headers.get("x-request-id"), r.json?.request_id]);
}

// ---- rate limit (last: it spends this key's budget) ---------------------------------------------
{
  const opId = crypto.randomUUID();
  const results = await Promise.all(Array.from({ length: 140 }, () => raw("GET", `/api/v1/operations/${opId}`, { headers: agentHeaders() })));
  const limited = results.filter((r) => r.status === 429);
  check("rate limit: a burst over 120/min per key gets 429", limited.length > 0, results.map((r) => r.status).slice(-5));
  if (limited[0]) {
    refused("rate limit: 429 carries PS_RATE_001", limited[0], 429, "PS_RATE_001");
    check("rate limit: 429 is marked retryable with Retry-After", limited[0].json?.error?.retryable === true && Number(limited[0].headers.get("retry-after")) > 0, [limited[0].json?.error, limited[0].headers.get("retry-after")]);
  }
  check("rate limit: no 5xx under the burst", results.every((r) => r.status < 500), [...new Set(results.map((r) => r.status))]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

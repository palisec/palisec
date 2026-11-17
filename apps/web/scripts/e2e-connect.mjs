#!/usr/bin/env node
/**
 * PALISEC Connect end to end: key scopes, rotation, integration reads, tenant isolation, webhooks
 * (signatures, retries with one event ID, redelivery, SSRF refusals), security findings, and the MCP
 * server through the official MCP client.
 *
 *   BASE_URL=http://localhost:3000 WEBHOOK_PORT=4555 node apps/web/scripts/e2e-connect.mjs
 *
 * The server must run with PALISEC_SECRETS_KEY set and PALISEC_TEST_WEBHOOK_ORIGIN=http://127.0.0.1:4555.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PORT = Number(process.env.WEBHOOK_PORT ?? 4555);
let passed = 0;
let failed = 0;
const check = (name, ok, detail) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- webhook receiver --------------------------------------------------------------------------
const received = [];
let receiverStatus = 200;
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body, status: receiverStatus });
    res.writeHead(receiverStatus).end();
  });
}).listen(PORT, "127.0.0.1");
const hookUrl = `http://127.0.0.1:${PORT}/hook`;

// ---- helpers -----------------------------------------------------------------------------------
async function call(method, path, { cookie, body, key, headers = {} } = {}) {
  const h = { origin: BASE, ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

async function signIn(account) {
  const c = await call("POST", "/auth/challenges", { body: { address: account.address, chain_id: 46630 } });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await account.signMessage({ message: c.body.message }) } });
  return (v.headers.get("set-cookie") ?? "").split(";")[0];
}

async function setupOrg(label) {
  const owner = privateKeyToAccount(generatePrivateKey());
  const agentAcct = privateKeyToAccount(generatePrivateKey());
  const token = privateKeyToAccount(generatePrivateKey()).address;
  const cookie = await signIn(owner);
  const p = await call("POST", "/policies", { cookie, body: { name: `${label} policy`, policy_key: `${label}_policy`, chain_id: 46630, account: agentAcct.address } });
  const draft = {
    ...p.body.draft,
    limits: { ...p.body.draft.limits, max_price_age_seconds: 120, max_pending_operations: 50 },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: { default: "deny", allowlist: [{ address: token, selectors: ["0xa9059cbb"], require_verified_code: false }], denylist: [] },
  };
  const saved = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: draft } });
  await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: saved.body.draft_hash } });
  const a = await call("POST", "/agents", { cookie, body: { name: `${label} agent`, chain_id: 46630, account: agentAcct.address, policy_id: p.body.id, framework: "langgraph" } });
  const k = await call("POST", `/agents/${a.body.id}/credentials`, { cookie, body: { label: "default" } });
  return { owner, cookie, policyId: p.body.id, agentId: a.body.id, key: k.body.secret, keyId: k.body.id, token, agentAcct };
}

const now = () => Math.floor(Date.now() / 1000);
const intent = (token, over = {}) => ({ request_id: `c-${crypto.randomUUID()}`, chain_id: 46630, to: token, value_wei: "0", data: "0x", gas_limit: 21000, deadline: now() + 120, ...over });

const A = await setupOrg("conn_a");
const B = await setupOrg("conn_b");
check("setup: two organizations with agents and keys", /^ps_test_/.test(A.key ?? "") && /^ps_test_/.test(B.key ?? ""), [A.key, B.key]);

// ---- scopes ------------------------------------------------------------------------------------
{
  const me = await call("GET", "/integration", { key: A.key });
  check("default key holds every scope", me.status === 200 && me.body.scopes?.length === 5 && me.body.framework === "langgraph", me.body);
  const narrow = await call("POST", `/agents/${A.agentId}/credentials`, { cookie: A.cookie, body: { label: "read only", scopes: ["operations:read"] } });
  check("narrowed key is created with its scopes", narrow.status === 201 && narrow.body.scopes?.join() === "operations:read", narrow.body);
  const write = await call("POST", "/operations", { key: narrow.body.secret, body: intent(A.token) });
  check("read-only key cannot create operations", write.status === 403 && write.body.error?.code === "PS_AUTH_001", write.body);
  const pol = await call("GET", "/integration/policy", { key: narrow.body.secret });
  check("read-only key cannot read the policy", pol.status === 403, pol.status);
  const who = await call("GET", "/integration", { key: narrow.body.secret });
  check("any valid key can identify itself", who.status === 200 && who.body.scopes?.length === 1, who.body);
  const bad = await call("POST", `/agents/${A.agentId}/credentials`, { cookie: A.cookie, body: { scopes: ["admin"] } });
  check("unknown scope is refused", bad.status === 400, bad.body);
  const policy = await call("GET", "/integration/policy", { key: A.key });
  check("integration reads the exact active policy version", policy.status === 200 && policy.body.version === 1 && policy.body.document?.schema_version === "1.0", policy.body);
}

// ---- operations, own reads, isolation ----------------------------------------------------------
const opA = await call("POST", "/operations", { key: A.key, body: intent(A.token, { data: "0xa9059cbb" + "00".repeat(64) }) });
check("operation recorded", opA.status === 201 && opA.body.decision === "ALLOW", opA.body);
{
  const list = await call("GET", "/integration/operations", { key: A.key });
  check("integration lists its own operations without calldata", list.status === 200 && list.body.operations.some((o) => o.operation_id === opA.body.operation_id) && list.body.operations.every((o) => o.details.calldata === undefined), list.body.operations?.length);
  const audit = await call("GET", "/integration/audit-events", { key: A.key });
  check("integration reads its own audit trail", audit.status === 200 && audit.body.events.some((e) => e.type.startsWith("operation.")), audit.body.events?.length);
  const cross = await call("GET", `/operations/${opA.body.operation_id}`, { key: B.key });
  check("another organization's key cannot read the operation", cross.status === 404, cross.status);
  const listB = await call("GET", "/integration/operations", { key: B.key });
  check("another organization's list does not include it", listB.body.operations.every((o) => o.operation_id !== opA.body.operation_id), listB.body.operations?.length);
}

// ---- rotation ----------------------------------------------------------------------------------
{
  const rotated = await call("POST", `/credentials/${A.keyId}/rotate`, { cookie: A.cookie });
  check("rotation returns a new secret once", rotated.status === 201 && /^ps_test_/.test(rotated.body.secret) && rotated.body.rotated_from === A.keyId, rotated.body);
  const old = await call("GET", "/integration", { key: A.key });
  check("the old key stops working at once", old.status === 401, old.status);
  const fresh = await call("GET", "/integration", { key: rotated.body.secret });
  check("the new key works with the same scopes", fresh.status === 200 && fresh.body.scopes?.length === 5, fresh.body);
  const again = await call("POST", `/credentials/${A.keyId}/rotate`, { cookie: A.cookie });
  check("a revoked key cannot be rotated again", again.status === 409, again.status);
  const crossRotate = await call("POST", `/credentials/${rotated.body.id}/rotate`, { cookie: B.cookie });
  check("another organization cannot rotate it", crossRotate.status === 409 || crossRotate.status === 404, crossRotate.status);
  const audit = await call("GET", "/audit-events?type=credential", { cookie: A.cookie });
  check("rotation is audited", audit.body.events?.some((e) => e.type === "credential.rotated"), audit.body.events?.map((e) => e.type));
  A.key = rotated.body.secret;
  A.keyId = rotated.body.id;
}

// ---- webhooks ----------------------------------------------------------------------------------
let hookId;
let hookSecret;
{
  for (const [name, url] of [
    ["plain http", "http://example.com/hook"],
    ["localhost", "https://localhost/hook"],
    ["loopback IP", "https://127.0.0.1/hook"],
    ["private range", "https://10.1.2.3/hook"],
    ["cloud metadata", "https://169.254.169.254/latest"],
    ["credentials in URL", "https://user:pass@example.com/hook"],
  ]) {
    const r = await call("POST", "/webhooks", { cookie: A.cookie, body: { url, events: ["operation.allowed"] } });
    check(`webhook destination refused: ${name}`, r.status === 400, r.body);
  }
  const badEvent = await call("POST", "/webhooks", { cookie: A.cookie, body: { url: hookUrl, events: ["everything"] } });
  check("unknown event type is refused", badEvent.status === 400, badEvent.body);
  const created = await call("POST", "/webhooks", { cookie: A.cookie, body: { url: hookUrl, events: ["operation.allowed", "operation.denied", "security.finding", "agent.status_changed"] } });
  hookId = created.body.id;
  hookSecret = created.body.secret;
  check("webhook created; secret shown once", created.status === 201 && /^whsec_/.test(hookSecret ?? ""), created.body);
  const list = await call("GET", "/webhooks", { cookie: A.cookie });
  check("webhook list never includes the secret", list.status === 200 && !JSON.stringify(list.body).includes(hookSecret), list.status);
  const otherOrg = await call("GET", "/webhooks", { cookie: B.cookie });
  check("another organization does not see the webhook", otherOrg.body.webhooks?.length === 0, otherOrg.body);
}

const verify = (r) => {
  const ts = r.headers["palisec-timestamp"];
  const expected = "v1=" + createHmac("sha256", hookSecret).update(`${ts}.${r.body}`).digest("hex");
  return r.headers["palisec-signature"] === expected;
};

{
  const ping = await call("POST", `/webhooks/${hookId}/test`, { cookie: A.cookie });
  const got = received.find((r) => r.headers["palisec-event-type"] === "ping");
  check("ping is delivered and signed with the secret", ping.body?.status === "delivered" && got && verify(got), [ping.body, got?.headers]);

  const before = received.length;
  const op = await call("POST", "/operations", { key: A.key, body: intent(A.token) });
  await sleep(1500);
  const evt = received.slice(before).find((r) => r.headers["palisec-event-type"] === "operation.allowed");
  const payload = evt ? JSON.parse(evt.body) : null;
  check("an operation emits a signed operation.allowed event", evt && verify(evt) && payload.data.operation_id === op.body.operation_id, payload);

  const idem = intent(A.token);
  const first = await call("POST", "/operations", { key: A.key, body: idem, headers: { "idempotency-key": idem.request_id } });
  await sleep(1200);
  const count = received.filter((r) => JSON.parse(r.body).data?.operation_id === first.body.operation_id).length;
  await call("POST", "/operations", { key: A.key, body: idem, headers: { "idempotency-key": idem.request_id } });
  await sleep(1200);
  const after = received.filter((r) => JSON.parse(r.body).data?.operation_id === first.body.operation_id).length;
  const ev = received.map((r) => JSON.parse(r.body)).find((e) => e.data?.operation_id === first.body.operation_id);
  check("operation events name their network (chain_id)", ev?.data?.chain_id === 46630, ev?.data);
  check("an idempotent retry emits no second event", count === 1 && after === 1, [count, after]);

  const tampered = { ...received[received.length - 1], body: received[received.length - 1].body.replace("ALLOW", "DENY") };
  check("a modified body fails signature verification", !verify(tampered));

  receiverStatus = 500;
  const beforeFail = received.length;
  await call("POST", "/operations", { key: A.key, body: intent(A.token, { to: privateKeyToAccount(generatePrivateKey()).address }) });
  await sleep(9000);
  const attempts = received.slice(beforeFail).filter((r) => r.headers["palisec-event-type"] === "operation.denied");
  const ids = new Set(attempts.map((r) => r.headers["palisec-event-id"]));
  check("a failing receiver is retried 3 times with the same event ID", attempts.length === 3 && ids.size === 1, [attempts.length, ids.size]);

  const deliveries = await call("GET", `/webhooks/${hookId}/deliveries`, { cookie: A.cookie });
  const failedDelivery = deliveries.body.deliveries?.find((d) => d.status === "failed" && d.event_id === [...ids][0]);
  check("the failed delivery is recorded", failedDelivery && failedDelivery.attempts === 3 && failedDelivery.last_status === 500, failedDelivery);

  receiverStatus = 200;
  const beforeRe = received.length;
  const re = await call("POST", `/webhook-deliveries/${failedDelivery.id}/redeliver`, { cookie: A.cookie });
  const reGot = received.slice(beforeRe).find((r) => r.headers["palisec-event-id"] === [...ids][0]);
  check("redelivery succeeds with the original event ID", re.body?.status === "delivered" && Boolean(reGot) && verify(reGot), [re.body, reGot?.headers["palisec-event-id"]]);
  const reAgain = await call("POST", `/webhook-deliveries/${failedDelivery.id}/redeliver`, { cookie: A.cookie });
  check("a delivered event cannot be redelivered", reAgain.status === 409, reAgain.status);
  const crossRe = await call("POST", `/webhook-deliveries/${failedDelivery.id}/redeliver`, { cookie: B.cookie });
  check("another organization cannot redeliver it", crossRe.status === 409, crossRe.status);
}

// ---- security findings -------------------------------------------------------------------------
{
  for (let i = 0; i < 5; i++) await call("POST", "/operations", { key: A.key, body: intent(privateKeyToAccount(generatePrivateKey()).address) });
  const ev = await call("GET", "/security-events?refresh=1", { cookie: A.cookie });
  const rep = ev.body.findings?.find((f) => f.category === "repeated_denial");
  check("repeated denials raise a finding with evidence", rep && rep.evidence.agent_id === A.agentId && rep.evidence.count_24h >= 5 && rep.evidence.operation_ids.length > 0, ev.body.findings?.map((f) => f.category));
  const tgt = ev.body.findings?.find((f) => f.category === "unapproved_contract");
  check("unapproved contracts raise a finding", Boolean(tgt), ev.body.findings?.map((f) => f.category));
  const again = await call("GET", "/security-events?refresh=1", { cookie: A.cookie });
  check("detection is idempotent: no duplicate open findings", again.body.findings.filter((f) => f.category === "repeated_denial" && f.status === "open").length === 1, again.body.findings.length);
  const otherOrg = await call("GET", "/security-events?refresh=1", { cookie: B.cookie });
  check("findings stay inside their organization", otherOrg.body.findings.every((f) => f.evidence.agent_id !== A.agentId), otherOrg.body.findings.length);
  await sleep(1500);
  check("new findings are sent as security.finding events", received.some((r) => r.headers["palisec-event-type"] === "security.finding" && verify(r)));
  const ack = await call("PATCH", `/security-events/${rep.id}`, { cookie: A.cookie, body: { status: "acknowledged" } });
  check("an operator acknowledges a finding", ack.status === 200 && ack.body.status === "acknowledged", ack.body);
  const crossAck = await call("PATCH", `/security-events/${rep.id}`, { cookie: B.cookie, body: { status: "resolved" } });
  check("another organization cannot change it", crossAck.status === 404, crossAck.status);
}

// ---- MCP ---------------------------------------------------------------------------------------
async function mcp(key) {
  const client = new Client({ name: "palisec-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } });
  await client.connect(transport);
  return client;
}
const parse = (r) => r.structuredContent ?? JSON.parse(r.content[0].text);
{
  const client = await mcp(A.key);
  const tools = (await client.listTools()).tools.map((t) => t.name);
  check("MCP lists the PALISEC tools", tools.includes("palisec_propose_transaction") && tools.includes("palisec_explain_authorization") && tools.length >= 10, tools);
  check("MCP exposes no activation, approval or signing tool", !tools.some((t) => /activate|sign|approve_|emergency|pause/.test(t)), tools);

  const i = intent(A.token);
  const r1 = parse(await client.callTool({ name: "palisec_propose_transaction", arguments: i }));
  const r2 = parse(await client.callTool({ name: "palisec_propose_transaction", arguments: i }));
  check("MCP proposes through the same authorization path", r1.decision === "ALLOW" && r1.operation_id && r1.authorization_id, r1);
  check("MCP retries with the same request_id return the same operation", r2.operation_id === r1.operation_id && r2.idempotent_replay === true, r2);

  const dry = parse(await client.callTool({ name: "palisec_evaluate_transaction", arguments: intent(A.token) }));
  check("MCP dry run reserves nothing", dry.dry_run === true && dry.operation_id === null, dry);

  const denied = parse(await client.callTool({ name: "palisec_propose_transaction", arguments: intent(privateKeyToAccount(generatePrivateKey()).address) }));
  const why = parse(await client.callTool({ name: "palisec_explain_authorization", arguments: { operation_id: denied.operation_id } }));
  check("MCP explains a denial with the deciding check", denied.decision === "DENY" && why.reason_code === "PS_TARGET_001" && why.deciding_check?.status === "fail", why);

  const cross = await client.callTool({ name: "palisec_get_transaction_status", arguments: { operation_id: (await call("POST", "/operations", { key: B.key, body: intent(B.token) })).body.operation_id } });
  check("MCP cannot read another organization's operation", cross.isError === true && parse(cross).error?.code === "PS_REQUEST_001", parse(cross));

  const bad = await client.callTool({ name: "palisec_propose_transaction", arguments: { ...intent(A.token), value_wei: "-1" } });
  check("MCP validates tool input", bad.isError === true, bad.content?.[0]?.text?.slice(0, 120));

  const valid = parse(await client.callTool({ name: "palisec_validate_policy", arguments: { document: { schema_version: "1.0" } } }));
  check("MCP validates a policy document without saving it", valid.valid === false && valid.errors.length > 0, valid);
  await client.close();

  const noMcp = await call("POST", `/agents/${A.agentId}/credentials`, { cookie: A.cookie, body: { label: "no mcp", scopes: ["operations:write", "operations:read"] } });
  const refused = await mcp(noMcp.body.secret).then(() => null).catch((e) => e);
  check("a key without the mcp scope cannot connect", refused !== null, refused?.message);

  const mcpOnly = await call("POST", `/agents/${A.agentId}/credentials`, { cookie: A.cookie, body: { label: "mcp read", scopes: ["mcp", "operations:read"] } });
  const limited = await mcp(mcpOnly.body.secret);
  const w = await limited.callTool({ name: "palisec_propose_transaction", arguments: intent(A.token) });
  check("an MCP key without operations:write cannot propose", w.isError === true && parse(w).error?.code === "PS_AUTH_001", parse(w));
  await limited.close();

  await call("POST", `/credentials/${mcpOnly.body.id}/revoke`, { cookie: A.cookie });
  const revoked = await mcp(mcpOnly.body.secret).then(() => null).catch((e) => e);
  check("a revoked key cannot use MCP", revoked !== null, revoked?.message);

  await call("POST", `/agents/${A.agentId}/pause`, { cookie: A.cookie, body: { confirm: true } });
  const paused = await mcp(A.key);
  const p = parse(await paused.callTool({ name: "palisec_propose_transaction", arguments: intent(A.token) }));
  check("a paused agent is denied through MCP too", p.decision === "DENY" && p.reason_code === "PS_PAUSED_001", p);
  await paused.close();
  await sleep(1500);
  check("pausing an agent emits agent.status_changed", received.some((r) => r.headers["palisec-event-type"] === "agent.status_changed" && verify(r)));
  await call("POST", `/agents/${A.agentId}/resume`, { cookie: A.cookie, body: { confirm: true } });
}

receiver.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

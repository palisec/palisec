#!/usr/bin/env node
/**
 * Asset-simulation latency: decision time with and without asset simulation, on live mainnet state, through
 * dry runs (nothing is reserved, recorded or sent). A USDG transfer from an account that holds USDG.
 *   BASE_URL=http://localhost:3002 ACCOUNT=0x… node apps/web/scripts/latency-asset-sim.mjs
 */
import { encodeFunctionData, erc20Abi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "http://localhost:3002";
const ACCOUNT = process.env.ACCOUNT;
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const N = Number(process.env.N ?? 20);
async function call(method, path, { cookie, key, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (cookie) h.cookie = cookie;
  if (key) h.authorization = `Bearer ${key}`;
  const t = performance.now();
  const res = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers, ms: performance.now() - t };
}
const owner = privateKeyToAccount(generatePrivateKey());
const c = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 4663 } });
const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
async function setup(label, safety) {
  const p = await call("POST", "/policies", { cookie, body: { name: label, policy_key: label, chain_id: 4663, account: ACCOUNT } });
  const d = p.body.draft;
  const doc = { ...d, asset_safety: { ...d.asset_safety, enabled: safety }, limits: { ...d.limits, max_price_age_seconds: 600, max_pending_operations: 50 }, cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 }, contracts: { default: "deny", allowlist: [{ address: USDG, selectors: ["0xa9059cbb"], require_verified_code: false }], denylist: [] } };
  const s = await call("PUT", `/policies/${p.body.id}`, { cookie, body: { document: doc } });
  await call("POST", `/policies/${p.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  const a = await call("POST", "/agents", { cookie, body: { name: label, chain_id: 4663, account: ACCOUNT, policy_id: p.body.id } });
  // A second agent on the same account starts paused for the delay; wait it out.
  await new Promise((r) => setTimeout(r, 3600));
  await call("GET", "/agents", { cookie });
  return (await call("POST", `/agents/${a.body.id}/credentials`, { cookie, body: {} })).body.secret;
}
const onKey = await setup("lat_on", true);
const offKey = await setup("lat_off", false);
const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: ["0x000000000000000000000000000000000000dEaD", 10_000n] });
const run = async (key) => {
  const out = [];
  let last;
  for (let i = 0; i < N; i++) {
    const r = await call("POST", "/authorizations/evaluate", { key, body: { request_id: `l-${crypto.randomUUID()}`, chain_id: 4663, to: USDG, value_wei: "0", data, gas_limit: 100000, deadline: Math.floor(Date.now() / 1000) + 120 } });
    out.push(r.ms);
    last = r.body;
    await new Promise((res) => setTimeout(res, 300));
  }
  out.sort((a, b) => a - b);
  return { p50: Math.round(out[Math.floor(N / 2)]), p95: Math.round(out[Math.ceil(N * 0.95) - 1]), last };
}
const off = await run(offKey);
const on = await run(onKey);
console.log(`without simulation: p50 ${off.p50} ms, p95 ${off.p95} ms (${off.last.decision})`);
console.log(`with simulation:    p50 ${on.p50} ms, p95 ${on.p95} ms (${on.last.decision})`);
console.log(`added by simulation: p50 ${on.p50 - off.p50} ms, p95 ${on.p95 - off.p95} ms`);
console.log(`mainnet decision asset check: ${on.last.checks?.find((c) => c.id === "asset")?.detail}`);

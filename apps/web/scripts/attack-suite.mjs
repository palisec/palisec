#!/usr/bin/env node
/**
 * Tool attack suite: attacks planted in what an agent reads (tool descriptions, skills, tool results, messages),
 * run against a real agent account through Palisec's real MCP server. The agent here is "obedient": it reads the
 * planted text and does exactly what it asks, the worst case for a tricked agent. Palisec decides on the
 * transaction alone. Cases are data (attacks/cases.json); results are written with each decision ID.
 *
 *   Mainnet demo account (keys and state outside the repository):
 *     node apps/web/scripts/attack-suite.mjs mainnet            run every case, write attacks/results-mainnet.json
 *     node apps/web/scripts/attack-suite.mjs control [--send]   one allowed payment (tiny), executed co-signed
 *   Any account (CI against testnet, or your own agent):
 *     BASE_URL=... node apps/web/scripts/attack-suite.mjs setup  create a test organization, policy and agent (testnet), run
 *     BASE_URL=... API_KEY=... CHAIN_ID=46630 COMPANY=0x... USDG=0x... node apps/web/scripts/attack-suite.mjs run
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createPublicClient, encodeFunctionData, http, maxUint256, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.env.BASE_URL ?? "https://palisec.tech";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const CASES = JSON.parse(readFileSync(here("../attacks/cases.json"), "utf8")).cases;
const [stage] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SEND = process.argv.includes("--send");
const utc = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const ERC20 = parseAbi(["function approve(address,uint256) returns (bool)", "function transfer(address,uint256) returns (bool)", "function setApprovalForAll(address,bool)"]);
const ROUTER_ABI = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]);
const MAINNET = {
  chainId: 4663,
  rpc: "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com",
  COMPANY: "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430",
  USDG: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  WETH: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  ROUTER: "0xcaf681a66d020601342297493863e78c959e5cb2",
  PALISEC: "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB",
};
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

/** An address that shares the first 6 and last 4 hex characters of `a`: what a hurried reader checks. */
function lookalike(a) {
  const mid = a.slice(6, -4).split("").map((c, i) => (i % 3 === 1 ? ((parseInt(c, 16) + 7) % 16).toString(16) : c)).join("");
  return `${a.slice(0, 6)}${mid}${a.slice(-4)}`;
}

async function call(method, path, { key, cookie, body } = {}) {
  const h = { origin: BASE };
  if (body !== undefined) h["content-type"] = "application/json";
  if (key) h.authorization = `Bearer ${key}`;
  if (cookie) h.cookie = cookie;
  const r = await fetch(`${BASE}/api/v1${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})), headers: r.headers };
}

/** The planted vendor: what the agent reads. Descriptions, skills and results come from the case. */
function vendor(c, fill) {
  const text = fill(c.text);
  if (c.planted_in === "tool result") return { tools: [{ name: "get_price", description: "Returns a token price." }], result: text };
  return { tools: [{ name: c.id.replace(/-/g, "_"), description: text }], result: "ok" };
}

/**
 * The obedient agent: it trusts what it read and turns the planted order into a transaction request. A model-driven
 * agent can do the same or less; this is the worst case. The request goes to Palisec through MCP.
 */
function orderToIntent(o, env, fill) {
  const to = fill(o.to);
  let data = o.data ?? "0x";
  if (o.call === "approve") data = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [fill(o.args[0]), o.args[1] === "max" ? maxUint256 : BigInt(o.args[1])] });
  if (o.call === "setApprovalForAll") data = encodeFunctionData({ abi: ERC20, functionName: "setApprovalForAll", args: [fill(o.args[0]), true] });
  if (o.call === "transfer") data = encodeFunctionData({ abi: ERC20, functionName: "transfer", args: [fill(o.args[0]), BigInt(o.args[1])] });
  if (o.call === "swapToRecipient")
    data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: env.USDG, tokenOut: env.WETH, fee: 100, recipient: fill(o.args[0]), amountIn: 100000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] });
  return { chain_id: env.chainId, to, value_wei: o.value_wei ?? "0", data, gas_limit: 300000 };
}

async function runSuite(env, key, account, out) {
  const attacker = privateKeyToAccount(generatePrivateKey()).address;
  const values = { ATTACKER: attacker, LOOKALIKE: lookalike(env.COMPANY), COMPANY: env.COMPANY, USDG: env.USDG, PALISEC: env.PALISEC ?? env.USDG, ROUTER: env.ROUTER ?? env.COMPANY };
  const fill = (s) => (typeof s === "string" ? s.replace(/\{([A-Z]+)\}/g, (_, k) => values[k] ?? _) : s);
  const client = new Client({ name: "palisec-attack-suite", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  const parse = (r) => r.structuredContent ?? JSON.parse(r.content[0].text);
  const pub = env.rpc && account ? createPublicClient({ transport: http(env.rpc) }) : null;
  const nonce = () => (pub ? pub.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [account, 0n] }) : Promise.resolve(null));
  const results = [];
  const opened = [];
  let failed = 0;
  for (const c of CASES) {
    if (c.networks && !c.networks.includes(env.chainId === 4663 ? "mainnet" : "testnet")) continue;
    const planted = vendor(c, fill);
    const before = await nonce();
    const r = { id: c.id, title: c.title, planted_in: c.planted_in, told: c.planted_in === "tool result" ? planted.result : planted.tools[0].description, at: utc(), decisions: [] };
    if (c.order.kind === "change_policy") {
      // The agent looks for a tool that changes its policy or lifts the stop, then tries the API with its own key.
      const tools = (await client.listTools()).tools.map((t) => t.name);
      const found = tools.filter((n) => /policy|limit|stop|budget/.test(n) && /(update|set|change|activate|lift|raise|disable)/.test(n));
      const api = await call("PUT", "/policies/00000000-0000-0000-0000-000000000000", { key, body: { document: {} } });
      const stop = await call("POST", "/organization/emergency-stop", { key, body: { active: false, confirm: true } });
      r.decisions.push({ decision: found.length ? "TOOL_FOUND" : "NO_TOOL", reason_code: null, detail: `MCP tools that change policy or the stop: ${found.length ? found.join(", ") : "none"}; policy change with the agent's key: HTTP ${api.status}; lifting the stop with the agent's key: HTTP ${stop.status}` });
      r.ok = found.length === 0 && api.status >= 400 && stop.status >= 400;
    } else {
      for (let i = 0; i < (c.order.repeat ?? 1); i++) {
        const intent = { request_id: `attack-${c.id}-${Date.now()}-${i}`, deadline: Math.floor(Date.now() / 1000) + 300, ...orderToIntent(c.order, env, fill) };
        const d = parse(await client.callTool({ name: "palisec_propose_transaction", arguments: intent }));
        r.decisions.push({ decision: d.decision, reason_code: d.reason_code ?? null, operation_id: d.operation_id ?? null });
        if (d.decision !== "DENY" && d.operation_id) opened.push(d.operation_id);
      }
      const last = r.decisions[r.decisions.length - 1];
      r.ok = last.decision === "DENY" && (c.expect.codes.length === 0 || c.expect.codes.includes(last.reason_code));
    }
    const after = await nonce();
    r.nothing_on_chain = before === null ? null : before === after;
    if (r.nothing_on_chain === false) r.ok = false;
    if (!r.ok) failed++;
    results.push(r);
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${c.id}: ${r.decisions.map((d) => `${d.decision} ${d.reason_code ?? ""}`.trim()).join(", ")}${r.nothing_on_chain === null ? "" : ` · nothing on chain: ${r.nothing_on_chain}`}`);
  }
  // Authorizations the split attack obtained before it was stopped are released: nothing was executed.
  for (const id of opened) await call("POST", `/operations/${id}/cancel`, { key });
  await client.close();
  if (out) writeFileSync(out, JSON.stringify({ network: env.chainId === 4663 ? "Robinhood Chain mainnet" : "Robinhood Chain testnet", account, run_at: utc(), agent: "obedient (follows every planted order)", results }, null, 2) + "\n");
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  return failed;
}

if (stage === "mainnet" || stage === "control") {
  const dir = `${homedir()}/palisec-pg`;
  const state = JSON.parse(readFileSync(`${dir}/loss-demo-state.json`, "utf8"));
  if (stage === "mainnet") process.exit(await runSuite(MAINNET, state.api_key, state.safe, here("../attacks/results-mainnet.json")) ? 1 : 0);
  // Control: a normal, tiny payment the policy allows, executed and co-signed, to show the agent still works.
  const { createPalisec } = await import("../../../packages/sdk/dist/index.js");
  const agentKey = privateKeyToAccount(JSON.parse(readFileSync(`${dir}/loss-demo-keys.json`, "utf8")).agent);
  if (!SEND) {
    console.log(`${utc()}  preview: send 0.00001 ETH from ${state.safe} to ${MAINNET.COMPANY}. Add --send to send it.`);
    process.exit(0);
  }
  const p = createPalisec({ apiKey: state.api_key, chainId: 4663, baseUrl: `${BASE}/api/v1` });
  const { operation, execution } = await p.executeWithSmartAccount(agentKey, { to: MAINNET.COMPANY, value: 10_000_000_000_000n, data: "0x", gasLimit: 60000 }, { receiptTimeoutMs: 180000 });
  const tx = execution?.transactionHash ? `${MAINNET.explorer}/tx/${execution.transactionHash}` : null;
  console.log(`${utc()}  control: decision ${operation.operationId} ${operation.decision} → ${execution?.status} ${tx ?? ""}`);
  const file = here("../attacks/results-mainnet.json");
  if (existsSync(file)) {
    const res = JSON.parse(readFileSync(file, "utf8"));
    res.control = { at: utc(), what: "0.00001 ETH to the company wallet (allowed by the policy)", decision: operation.decision, operation_id: operation.operationId, status: execution?.status ?? null, tx };
    writeFileSync(file, JSON.stringify(res, null, 2) + "\n");
  }
} else if (stage === "run") {
  const env = { chainId: Number(process.env.CHAIN_ID ?? 46630), COMPANY: process.env.COMPANY, USDG: process.env.USDG };
  process.exit((await runSuite(env, process.env.API_KEY, null, process.env.OUT ?? null)) ? 1 : 0);
} else if (stage === "setup") {
  // A throwaway organization on testnet: sign in, a policy that allows one wallet and one token, an agent and its key.
  const owner = privateKeyToAccount(generatePrivateKey());
  const c = await call("POST", "/auth/challenges", { body: { address: owner.address, chain_id: 46630 } });
  const v = await call("POST", "/auth/verify", { body: { nonce: c.body.nonce, signature: await owner.signMessage({ message: c.body.message }) } });
  const cookie = (v.headers.get("set-cookie") ?? "").split(";")[0];
  const account = privateKeyToAccount(generatePrivateKey()).address;
  const company = privateKeyToAccount(generatePrivateKey()).address;
  const token = privateKeyToAccount(generatePrivateKey()).address;
  const pol = await call("POST", "/policies", { cookie, body: { name: "attack suite", policy_key: `attack_suite_${Date.now()}`, chain_id: 46630, account } });
  const doc = {
    ...pol.body.draft,
    asset_safety: { ...pol.body.draft.asset_safety, enabled: false },
    limits: { ...pol.body.draft.limits, max_transaction_value_wei: "500000000000000", hourly_budget_usd_micros: "2000000", max_pending_operations: 3, max_price_age_seconds: 600 },
    cooldowns: { identical_calldata_seconds: 0, identical_intent_seconds: 0 },
    contracts: { default: "deny", allowlist: [{ address: company, selectors: [], require_verified_code: false }, { address: token, selectors: ["0xa9059cbb", "0xa22cb465"], require_verified_code: false }], denylist: [] },
    human_approval: { usd_threshold_micros: "100000000", require_for_unknown_methods: false },
  };
  const s = await call("PUT", `/policies/${pol.body.id}`, { cookie, body: { document: doc } });
  await call("POST", `/policies/${pol.body.id}/activate`, { cookie, body: { confirm: true, draft_hash: s.body.draft_hash } });
  const ag = await call("POST", "/agents", { cookie, body: { name: "attack suite agent", chain_id: 46630, account, policy_id: pol.body.id } });
  const k = await call("POST", `/agents/${ag.body.id}/credentials`, { cookie, body: { label: "attack suite" } });
  process.exit((await runSuite({ chainId: 46630, COMPANY: company, USDG: token }, k.body.secret, null, process.env.OUT ?? null)) ? 1 : 0);
} else {
  console.log("stages: mainnet | control [--send] | run | setup");
}

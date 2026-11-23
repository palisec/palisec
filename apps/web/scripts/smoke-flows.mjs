#!/usr/bin/env node
/**
 * Live flows through the PALISEC smart account, one flow per run. Sibling of smoke-live.mjs
 * (flow A); run on the operator's own computer. Keys are read from the environment or asked for
 * with hidden input, and are never printed or written anywhere.
 *
 *   node smoke-flows.mjs --flow B           preview: chain read + dry run (reserves and records nothing)
 *   node smoke-flows.mjs --flow B --send    records the decision; A and B then execute on chain
 *
 * Flows (amounts in ETH):
 *   A  0.000001 to the recipient          ALLOW, executes            (F: run with the emergency stop on, then off)
 *   B  0.00001  to the recipient          REQUIRES_HUMAN_SIGNATURE: waits for the console approval, then executes
 *   C  0.000001 to 0x…dEaD (off-policy)   DENY; never signs; checks that the account's nonce did not move
 *   D  same intent as A                   DENY by cooldown when run right after A; never signs
 *   E  0.00002  to the recipient          DENY by the hourly budget; never signs
 *
 * Environment (optional, so several flows can run without retyping):
 *   PALISEC_API_KEY, PALISEC_AGENT_KEY (secrets), SMOKE_ACCOUNT, SMOKE_RECIPIENT.
 */
import { createInterface } from "node:readline";
import { createPalisec, PalisecDeniedError, safeOpTypedData } from "../../../packages/sdk/dist/index.js";
import { createPublicClient, encodeFunctionData, formatEther, http, isAddress, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NETS = {
  live: { chainId: 4663, name: "Robinhood Chain mainnet", rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com" },
  test: { chainId: 46630, name: "Robinhood Chain testnet", rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com" },
};
const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const OFF_POLICY = "0x000000000000000000000000000000000000dEaD";
const GAS_BOUND = 400_000n;
const FLOWS = {
  A: { value: 1_000_000_000_000n, offPolicy: false, execute: true, expect: "ALLOW (DENY PS_PAUSED_001 while the emergency stop is on)" },
  B: { value: 10_000_000_000_000n, offPolicy: false, execute: true, expect: "REQUIRES_HUMAN_SIGNATURE, then approval in the console" },
  C: { value: 1_000_000_000_000n, offPolicy: true, execute: false, expect: "DENY PS_TARGET_001" },
  D: { value: 1_000_000_000_000n, offPolicy: false, execute: false, expect: "DENY PS_LOOP_001 (run right after A)" },
  E: { value: 20_000_000_000_000n, offPolicy: false, execute: false, expect: "DENY PS_BUDGET_001 (after B and A in the same hour)" },
  // A tiny real swap, ETH -> USDG on Uniswap v3 (SwapRouter02, 0.01% pool), checked by asset safety.
  S: { value: 250_000_000_000_000n, offPolicy: false, execute: true, swap: true, expect: "ALLOW with the asset check (tax, sell leg), then executes" },
};
// Uniswap v3 on Robinhood Chain (developers.uniswap.org, Robinhood Chain deployments), checked on chain.
const SWAP_ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const POOL_FEE = 100;

const args = process.argv.slice(2);
const flowName = (args[args.indexOf("--flow") + 1] ?? "").toUpperCase();
const flow = args.includes("--flow") ? FLOWS[flowName] : undefined;
if (!flow) throw new Error("Choose a flow: --flow A|B|C|D|E|S (F = A with the emergency stop on, then off; S = tiny swap).");
const send = args.includes("--send");
// Upoch: every recorded demo run ends with a checkpoint on Upoch, so the demo agent's last checkpoint
// never goes stale. Uses the checkpoint key file (UPOCH_KEY_FILE, or ~/palisec-pg/upoch-executor.json when
// present); without one it says so and skips. Runs after the flow, whatever its outcome.
if (send) {
  const { existsSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { homedir } = await import("node:os");
  const { fileURLToPath } = await import("node:url");
  const keyFile = process.env.UPOCH_KEY_FILE || `${homedir()}/palisec-pg/upoch-executor.json`;
  const script = fileURLToPath(new URL("./upoch-checkpoint.mjs", import.meta.url));
  process.on("exit", () => {
    if (!existsSync(keyFile) || !existsSync(script)) return console.log("\nUpoch checkpoint skipped: no checkpoint key file on this computer.");
    console.log("\nUpoch checkpoint for this run:");
    spawnSync(process.execPath, [script, "--send"], { stdio: "inherit", env: { ...process.env, UPOCH_KEY_FILE: keyFile } });
  });
}

// One reader for every question. While a hidden answer is typed, nothing is echoed to the screen.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let muted = false;
const write = rl._writeToOutput?.bind(rl);
if (write) rl._writeToOutput = (s) => (muted ? undefined : write(s));
const lines = rl[Symbol.asyncIterator]();
async function ask(question, hidden = false) {
  process.stdout.write(question);
  muted = hidden;
  const { value } = await lines.next();
  if (muted) process.stdout.write("\n");
  muted = false;
  return (value ?? "").trim();
}

const apiKey = process.env.PALISEC_API_KEY || (await ask("Palisec agent API key (hidden): ", true));
const kind = /^ps_(live|test)_[0-9a-f]{48}$/.exec(apiKey)?.[1];
if (!kind) throw new Error("That is not a Palisec agent key (ps_live_… or ps_test_…).");
const net = NETS[kind];
const agentKey = process.env.PALISEC_AGENT_KEY || (await ask("Agent private key, 0x… (hidden): ", true));
if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error("The agent private key must be 0x followed by 64 hex characters.");
const agent = privateKeyToAccount(agentKey);
const smartAccount = process.env.SMOKE_ACCOUNT || (await ask("Smart account address: "));
const recipient = flow.swap ? smartAccount : process.env.SMOKE_RECIPIENT || (await ask("Recipient address (allowlisted): "));
rl.close();
if (!isAddress(smartAccount) || !isAddress(recipient)) throw new Error("Both addresses must be 0x followed by 40 hex characters.");
const to = flow.swap ? SWAP_ROUTER : flow.offPolicy ? OFF_POLICY : recipient;

const chain = createPublicClient({ transport: http(net.rpc) });
const nonceOf = () =>
  chain.readContract({ address: ENTRY_POINT, abi: parseAbi(["function getNonce(address,uint192) view returns (uint256)"]), functionName: "getNonce", args: [smartAccount, 0n] });
const [chainId, balance, gasPrice, nonceBefore] = await Promise.all([chain.getChainId(), chain.getBalance({ address: smartAccount }), chain.getGasPrice(), nonceOf()]);
if (chainId !== net.chainId) throw new Error(`The RPC answered chain ${chainId}, expected ${net.chainId}.`);
const maxGas = GAS_BOUND * gasPrice;
console.log(`
Flow           ${flowName}: expected ${flow.expect}
Network        ${net.name} (${net.chainId})
Smart account  ${smartAccount}  balance ${formatEther(balance)} ETH  nonce ${nonceBefore}
Request        ${formatEther(flow.value)} ETH to ${to}${flow.offPolicy ? " (off-policy)" : ""}
Gas            ${flow.execute ? `at most ~${formatEther(maxGas)} ETH, paid by the smart account, only if it executes` : "none: this flow never signs or submits"}`);
if (flow.execute && balance < flow.value + maxGas) throw new Error("The smart account's balance does not cover the amount plus gas.");

// Flow S: quote now, accept at most 3% less, and send the USDG back to the smart account itself.
let swapData = "0x";
let quoted = 0n;
if (flow.swap) {
  const q = await chain.simulateContract({
    address: QUOTER,
    abi: parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"]),
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn: WETH, tokenOut: USDG, amountIn: flow.value, fee: POOL_FEE, sqrtPriceLimitX96: 0n }],
  });
  quoted = q.result[0];
  swapData = encodeFunctionData({
    abi: parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)"]),
    functionName: "exactInputSingle",
    args: [{ tokenIn: WETH, tokenOut: USDG, fee: POOL_FEE, recipient: smartAccount, amountIn: flow.value, amountOutMinimum: (quoted * 97n) / 100n, sqrtPriceLimitX96: 0n }],
  });
  console.log(`Swap           ${formatEther(flow.value)} ETH -> about ${Number(quoted) / 1e6} USDG on Uniswap v3 (router ${SWAP_ROUTER}), at least ${Number((quoted * 97n) / 100n) / 1e6}`);
}

const palisec = createPalisec({ apiKey, chainId: net.chainId });
// The swap needs calldata and the asset_intent, so flow S calls the API directly (same endpoints).
const BASE = (process.env.PALISEC_BASE_URL || "https://palisec.tech").replace(/\/$/, "");
async function decideRaw(path) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      request_id: `swap_${Date.now()}`, chain_id: net.chainId, to, value_wei: flow.value.toString(), data: swapData, gas_limit: Number(GAS_BOUND),
      deadline: Math.floor(Date.now() / 1000) + 600,
      asset_intent: { spend: [{ token: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", amount: flow.value.toString() }], receive: [{ token: USDG, amount: quoted.toString() }] },
    }),
  });
  const b = await res.json();
  if (!b.decision) throw new Error(`Palisec refused the request: ${res.status} ${JSON.stringify(b.error ?? b)}`);
  const asset = b.checks?.find((c) => c.id === "asset");
  if (asset) console.log(`\nAsset check    ${asset.status}: ${asset.detail}`);
  return { decision: b.decision, reasonCode: b.reason_code, state: b.state, operationId: b.operation_id, requestId: b.request_id, message: b.message };
}
const show = (label, op) =>
  console.log(`
${label}
Decision       ${op.decision}  ${op.reasonCode ?? ""}
State          ${op.state}
Decision ID    ${op.operationId ?? "- (dry run: not recorded)"}
Request ID     ${op.requestId}
Message        ${op.message}
Time           ${new Date().toISOString()}`);

if (!send) {
  show("Dry run now (nothing reserved or recorded)", flow.swap ? await decideRaw("/authorizations/evaluate") : await palisec.evaluate({ to, value: flow.value }));
  console.log("\nPreview only. Run again with --send to record the decision" + (flow.execute ? " and execute." : "."));
  process.exit(0);
}

let op = flow.swap ? await decideRaw("/operations") : await palisec.authorize({ to, value: flow.value });
show("Recorded decision", op);
if (!flow.execute || op.decision === "DENY") {
  if (op.decision !== "DENY") console.log("\nNot denied, but this flow never signs: nothing will execute. Its reservation expires on its own.");
  const nonceAfter = await nonceOf();
  console.log(`\nOn chain       nonce ${nonceBefore} → ${nonceAfter}: ${nonceAfter === nonceBefore ? "nothing was submitted from the smart account" : "CHANGED, check the explorer"}`);
  console.log(`Explorer       ${net.explorer}/address/${smartAccount}`);
  process.exit(0);
}
if (op.state === "pending_approval") {
  console.log("\nHeld for a human. Approve it in the console (Approvals) with your wallet. Waiting up to 15 minutes…");
  op = await palisec.waitForApproval(op.operationId, { timeoutMs: 15 * 60_000 });
  show("After approval", op);
}
if (!["authorized", "approved"].includes(op.state)) throw new PalisecDeniedError(op);

// A bundler gas-efficiency refusal reaches nothing on chain, and PALISEC records the measured gas: prepare
// and sign again (the gas limits are part of what the agent signs). At most two more attempts.
let execution;
for (let attempt = 1; ; attempt++) {
  const prepared = await palisec.prepareExecution(op.operationId);
  const signature = await agent.signTypedData(safeOpTypedData(prepared.userOperation, net.chainId));
  try {
    execution = await palisec.submitExecution(op.operationId, signature);
    break;
  } catch (e) {
    if (attempt >= 3 || !/efficiency too low/i.test(e?.message ?? "")) throw e;
    console.log(`\nBundler refused the gas limits (nothing reached the chain): ${e.message.split(" Nothing reached")[0]}\nPreparing and signing again with the measured gas (attempt ${attempt + 1})…`);
  }
}
const until = Date.now() + 180_000;
while (execution.status === "submitted" && Date.now() < until) {
  await new Promise((r) => setTimeout(r, 3000));
  execution = await palisec.getExecution(op.operationId);
}
console.log(`
Execution      ${execution.status}
UserOp hash    ${execution.userOpHash ?? "-"}
Transaction    ${execution.transactionHash ? `${net.explorer}/tx/${execution.transactionHash}` : "not mined yet: check the console's Operations page"}`);

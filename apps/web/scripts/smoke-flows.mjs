#!/usr/bin/env node
/**
 * Phase 3 live flows through the PALISEC smart account, one flow per run. Sibling of smoke-live.mjs
 * (flow A); run by the owner on their own computer. Keys are read from the environment or asked for
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
import { createPalisec, PalisecDeniedError, safeOpTypedData } from "@palisec/sdk";
import { createPublicClient, formatEther, http, isAddress, parseAbi } from "viem";
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
};

const args = process.argv.slice(2);
const flowName = (args[args.indexOf("--flow") + 1] ?? "").toUpperCase();
const flow = args.includes("--flow") ? FLOWS[flowName] : undefined;
if (!flow) throw new Error("Choose a flow: --flow A|B|C|D|E (F = A with the emergency stop on, then off).");
const send = args.includes("--send");

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
const recipient = process.env.SMOKE_RECIPIENT || (await ask("Recipient address (allowlisted): "));
rl.close();
if (!isAddress(smartAccount) || !isAddress(recipient)) throw new Error("Both addresses must be 0x followed by 40 hex characters.");
const to = flow.offPolicy ? OFF_POLICY : recipient;

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

const palisec = createPalisec({ apiKey, chainId: net.chainId });
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
  show("Dry run now (nothing reserved or recorded)", await palisec.evaluate({ to, value: flow.value }));
  console.log("\nPreview only. Run again with --send to record the decision" + (flow.execute ? " and execute." : "."));
  process.exit(0);
}

let op = await palisec.authorize({ to, value: flow.value });
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

const prepared = await palisec.prepareExecution(op.operationId);
const signature = await agent.signTypedData(safeOpTypedData(prepared.userOperation, net.chainId));
let execution = await palisec.submitExecution(op.operationId, signature);
const until = Date.now() + 180_000;
while (execution.status === "submitted" && Date.now() < until) {
  await new Promise((r) => setTimeout(r, 3000));
  execution = await palisec.getExecution(op.operationId);
}
console.log(`
Execution      ${execution.status}
UserOp hash    ${execution.userOpHash ?? "-"}
Transaction    ${execution.transactionHash ? `${net.explorer}/tx/${execution.transactionHash}` : "not mined yet: check the console's Operations page"}`);

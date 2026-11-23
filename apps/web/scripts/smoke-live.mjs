#!/usr/bin/env node
/**
 * Live smoke test of PALISEC smart-account execution (against the live API). Run on
 * their own computer; the agent key never leaves it and is never printed or written anywhere.
 *
 *   mkdir palisec-smoke && cd palisec-smoke && npm init -y && npm install @palisec/sdk viem
 *   copy this file in, then:
 *   node smoke-live.mjs           preview only: network, balance, amount, estimated gas. Sends nothing.
 *   node smoke-live.mjs --send    authorizes, signs, PALISEC co-signs and submits; prints the explorer link.
 *
 * Asks for (hidden input where secret):
 *   Palisec agent API key   ps_live_… (mainnet) or ps_test_… (testnet): picks the network
 *   Agent private key       the key whose address is the smart account's "agent signing address"
 *   Smart account address   from the console's Smart accounts page
 *   Recipient address       where the tiny transfer goes (e.g. your own wallet)
 * Amount: SMOKE_VALUE_WEI (default 1000000000000 wei = 0.000001 ETH).
 */
import { createInterface } from "node:readline";
import { createPalisec } from "../../../packages/sdk/dist/index.js";
import { createPublicClient, formatEther, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const NETS = {
  live: { chainId: 4663, name: "Robinhood Chain mainnet", rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com" },
  test: { chainId: 46630, name: "Robinhood Chain testnet", rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com" },
};
// A Safe 4337 user operation (validation, co-signature check, call, EntryPoint overhead): a generous bound.
const GAS_BOUND = 400_000n;

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

const send = process.argv.includes("--send");
const apiKey = await ask("Palisec agent API key (hidden): ", true);
const kind = /^ps_(live|test)_[0-9a-f]{48}$/.exec(apiKey)?.[1];
if (!kind) throw new Error("That is not a Palisec agent key (ps_live_… or ps_test_…).");
const net = NETS[kind];
const agentKey = await ask("Agent private key, 0x… (hidden): ", true);
if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) throw new Error("The agent private key must be 0x followed by 64 hex characters.");
const agent = privateKeyToAccount(agentKey);
const smartAccount = await ask("Smart account address: ");
const to = await ask("Recipient address: ");
if (!isAddress(smartAccount) || !isAddress(to)) throw new Error("Both addresses must be 0x followed by 40 hex characters.");
rl.close();
const value = BigInt(process.env.SMOKE_VALUE_WEI || "1000000000000");

const chain = createPublicClient({ transport: http(net.rpc) });
const [chainId, balance, gasPrice] = await Promise.all([chain.getChainId(), chain.getBalance({ address: smartAccount }), chain.getGasPrice()]);
if (chainId !== net.chainId) throw new Error(`The RPC answered chain ${chainId}, expected ${net.chainId}.`);
const maxGas = GAS_BOUND * gasPrice;
console.log(`
Network        ${net.name} (${net.chainId})
Agent signer   ${agent.address}
Smart account  ${smartAccount}  balance ${formatEther(balance)} ETH
Send           ${formatEther(value)} ETH to ${to}
Gas, at most   ~${formatEther(maxGas)} ETH (${GAS_BOUND} gas at ${Number(gasPrice) / 1e9} gwei), paid by the smart account
Total, at most ~${formatEther(value + maxGas)} ETH`);
if (balance < value + maxGas) throw new Error("The smart account's balance does not cover the amount plus gas. Fund it first.");
if (!send) {
  console.log("\nPreview only: nothing was sent. Run again with --send to execute.");
  process.exit(0);
}

const palisec = createPalisec({ apiKey, chainId: net.chainId });
const { operation, execution } = await palisec.executeWithSmartAccount(agent, { to, value }, { receiptTimeoutMs: 180_000 });
console.log(`
Decision       ${operation.decision} (${operation.state}) ${operation.operationId}
Execution      ${execution.status}
UserOp hash    ${execution.userOpHash ?? "-"}
Transaction    ${execution.transactionHash ? `${net.explorer}/tx/${execution.transactionHash}` : "not mined yet: check the console's Operations page"}`);

#!/usr/bin/env node
/**
 * Agent links: deploys AgentLinks with the deterministic deployer (CREATE2, same address on any chain),
 * and prepares a Safe's on-chain declaration of its Zolva agent ID. Keys are read from files outside
 * the repository and are never printed.
 *
 *   (cd contracts && forge build) && node apps/web/scripts/links-deploy.mjs address   # address and cost; sends nothing
 *   node apps/web/scripts/links-deploy.mjs deploy                                    # mainnet deploy from the publisher key
 *   AGENT_KEY_FILE=… node apps/web/scripts/links-deploy.mjs declare-page <safe> <zolva-id> <out.html>
 *       signs the Safe transaction with the agent key and writes a page on which a co-owner wallet
 *       (MetaMask) executes it: one transaction, the co-owner pays gas. Nothing is sent by this script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  concat, createPublicClient, createWalletClient, defineChain, encodeFunctionData, formatEther, getAddress, getContractAddress,
  http, keccak256, pad, parseAbi, stringToHex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

const RPC = process.env.RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const SALT = keccak256(stringToHex("agent-links v1"));
export const ZOLVA_SERVICE = keccak256(stringToHex("zolva"));

const pub = createPublicClient({ chain, transport: http(RPC) });
const art = JSON.parse(readFileSync(new URL("../../../contracts/out/AgentLinks.sol/AgentLinks.json", import.meta.url), "utf8"));
const initCode = art.bytecode.object;
const address = getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: initCode });
const mode = process.argv[2] ?? "address";
const code = await pub.getCode({ address });
console.log(`AgentLinks address ${address}${code && code !== "0x" ? "  (deployed)" : ""}`);

if (mode === "address" || mode === "deploy") {
  const keys = JSON.parse(readFileSync(`${homedir()}/palisec-pg/registry-keys.json`, "utf8"));
  const from = privateKeyToAccount(keys.publisher);
  const [bal, gasPrice] = await Promise.all([pub.getBalance({ address: from.address }), pub.getGasPrice()]);
  console.log(`sender             ${from.address}  balance ${formatEther(bal)} ETH  gas price ${Number(gasPrice) / 1e9} gwei`);
  if (code && code !== "0x") process.exit(0);
  const gas = await pub.estimateGas({ account: from.address, to: CREATE2_DEPLOYER, data: concat([SALT, initCode]) });
  console.log(`deploy estimate    ${gas} gas = ${formatEther(gas * gasPrice)} ETH`);
  if (mode === "address") process.exit(0);
  const wallet = createWalletClient({ account: from, chain, transport: http(RPC) });
  const hash = await wallet.sendTransaction({ to: CREATE2_DEPLOYER, data: concat([SALT, initCode]) });
  const r = await pub.waitForTransactionReceipt({ hash });
  const deployed = await pub.getCode({ address });
  console.log(`deploy tx          ${hash}  status ${r.status}  gas ${r.gasUsed}  code ${deployed && deployed !== "0x" ? "present" : "MISSING"}`);
  process.exit(r.status === "success" && deployed && deployed !== "0x" ? 0 : 1);
}

if (mode === "declare-page") {
  const [safeArg, zolvaId, out] = process.argv.slice(3);
  if (!safeArg || !/^[0-9a-f-]{36}$/.test(zolvaId ?? "") || !out) throw new Error("usage: declare-page <safe> <zolva-id> <out.html>");
  if (!code || code === "0x") throw new Error("AgentLinks is not deployed yet");
  const safe = getAddress(safeArg);
  const agentKey = JSON.parse(readFileSync(process.env.AGENT_KEY_FILE, "utf8")).agent;
  const agent = privateKeyToAccount(agentKey);
  const SAFE = parseAbi([
    "function nonce() view returns (uint256)",
    "function getOwners() view returns (address[])",
    "function getThreshold() view returns (uint256)",
    "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
    "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns (bool)",
  ]);
  const data = encodeFunctionData({ abi: parseAbi(["function setLink(bytes32,string)"]), functionName: "setLink", args: [ZOLVA_SERVICE, zolvaId] });
  const [nonce, owners, threshold] = await Promise.all([
    pub.readContract({ address: safe, abi: SAFE, functionName: "nonce" }),
    pub.readContract({ address: safe, abi: SAFE, functionName: "getOwners" }),
    pub.readContract({ address: safe, abi: SAFE, functionName: "getThreshold" }),
  ]);
  const owner = (x) => owners.some((o) => o.toLowerCase() === x.toLowerCase());
  if (!owner(agent.address)) throw new Error("the agent key is not an owner of this Safe");
  if (threshold !== 2n) throw new Error(`expected threshold 2, found ${threshold}`);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const txArgs = [address, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO];
  const safeTxHash = await pub.readContract({ address: safe, abi: SAFE, functionName: "getTransactionHash", args: [...txArgs, nonce] });
  const agentSig = await sign({ hash: safeTxHash, privateKey: agentKey, to: "hex" });
  const coOwners = owners.filter((o) => o.toLowerCase() !== agent.address.toLowerCase() && o !== "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7");
  const pages = coOwners.map((co) => {
    // The co-owner executes: its own signature is "approved by msg.sender" (v = 1); signatures sorted by owner address.
    const coSig = concat([pad(co), pad("0x00"), "0x01"]);
    const sigs = BigInt(co) < BigInt(agent.address) ? concat([coSig, agentSig]) : concat([agentSig, coSig]);
    return { from: co, data: encodeFunctionData({ abi: SAFE, functionName: "execTransaction", args: [...txArgs, sigs] }) };
  });
  const tx = pages[0];
  writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Declare the Zolva agent on chain</title>
<style>body{font:15px system-ui;background:#011d1c;color:#edfffe;max-width:760px;margin:40px auto;padding:0 16px}button{font:inherit;padding:10px 16px;border-radius:6px;border:0;background:#9cf6ee;color:#012624;cursor:pointer}code,pre{font:12px ui-monospace,monospace;color:#cbfffc;white-space:pre-wrap;word-break:break-all}td{padding:4px 12px 4px 0;vertical-align:top}</style>
<h1>Declare the Zolva agent on chain</h1>
<p>The Palisec smart account below states on chain which Zolva agent it is linked to. It moves no funds: the transaction calls <code>setLink</code> on the AgentLinks contract, value 0.</p>
<table>
<tr><td>Network</td><td>Robinhood Chain mainnet (4663)</td></tr>
<tr><td>Smart account (Safe)</td><td><code>${safe}</code></td></tr>
<tr><td>Zolva agent ID</td><td><code>${zolvaId}</code></td></tr>
<tr><td>AgentLinks contract</td><td><code>${address}</code></td></tr>
<tr><td>Safe nonce</td><td>${nonce}</td></tr>
<tr><td>Safe transaction hash</td><td><code>${safeTxHash}</code></td></tr>
<tr><td>Signed by</td><td>the agent key <code>${agent.address}</code> (already signed)</td></tr>
<tr><td>Send from</td><td>the co-owner wallet <code>${tx.from}</code> (pays gas, about 0.000002 ETH)</td></tr>
</table>
<p><button id="go">Connect wallet and send</button></p>
<pre id="log"></pre>
<script>
const TX = ${JSON.stringify({ to: safe, from: tx.from, data: tx.data })};
const log = (m) => (document.getElementById("log").textContent += m + "\\n");
document.getElementById("go").onclick = async () => {
  const eth = window.ethereum;
  if (!eth) return log("No browser wallet found.");
  const [from] = await eth.request({ method: "eth_requestAccounts" });
  if (from.toLowerCase() !== TX.from.toLowerCase()) return log("Connected " + from + ". Switch MetaMask to " + TX.from + " and click again.");
  try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] }); }
  catch (e) { return log("Switch MetaMask to Robinhood Chain (4663) and click again."); }
  try {
    const hash = await eth.request({ method: "eth_sendTransaction", params: [{ from: TX.from, to: TX.to, data: TX.data, value: "0x0" }] });
    log("Sent: " + hash);
    log("Explorer: https://robinhoodchain.blockscout.com/tx/" + hash);
  } catch (e) { log("Not sent: " + (e && e.message ? e.message : e)); }
};
</script>`);
  console.log(`safe ${safe} nonce ${nonce} safeTxHash ${safeTxHash}`);
  console.log(`co-owner to send   ${tx.from}`);
  console.log(`page written       ${out}`);
  process.exit(0);
}
console.error("mode must be address, deploy or declare-page");
process.exit(2);

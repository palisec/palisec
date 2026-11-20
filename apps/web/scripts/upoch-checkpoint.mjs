#!/usr/bin/env node
/**
 * Phase 6.5 B1: the Palisec demo agent's checkpoints on Upoch (Robinhood Chain mainnet).
 *
 * The first run registers the agent's Upoch workflow (executor: the checkpoint key; guardian: the
 * company wallet, which is also the recovery owner of the agent's smart account, so the workflow is
 * linked to it), then every run commits one checkpoint of the demo agent's state: its smart account,
 * policy version and the newest Palisec decision. Only public facts go into the checkpoint data.
 *
 *   UPOCH_KEY_FILE=… node apps/web/scripts/upoch-checkpoint.mjs            preview (reads only, simulates)
 *   UPOCH_KEY_FILE=… node apps/web/scripts/upoch-checkpoint.mjs --send     register (once) and commit a checkpoint
 *
 * The key file holds the checkpoint key (and, after the first run, the workflow ID). Never printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatEther, http, keccak256, parseAbi, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const LEDGER = "0x6179d9123c3c1f9e82f948101a4350cb55aa8c27";
const SAFE = "0x375BdF5DA6b7440889e50f13C894A3C4AC988329";
const GUARDIAN = "0x989EfcD8Ad76E695CFD5ba915b1b12118471c430"; // company wallet = the smart account's recovery owner
const EXPLORER = "https://robinhoodchain.blockscout.com";
const ABI = parseAbi([
  "function workflowCount() view returns (uint256)",
  "function registerWorkflow(address[] executors, address[] guardians, (uint8,bool,uint32,uint32,uint32,uint32) policy, string metadataURI) returns (uint256)",
  "function submitCheckpoint(uint256 workflowId, bytes32 parentHash, bytes32 stateHash, bytes32 traceHash, string dataURI) returns (uint64)",
  "function getWorkflow(uint256) view returns ((address owner,address pendingOwner,uint8 status,(uint8 guardianThreshold,bool ownerApprovalRequired,uint32 ownerFallbackDelay,uint32 timelock,uint32 approvalWindow,uint32 executionWindow) policy,uint64 checkpointCount,uint64 headSequence,bytes32 headHash,uint256 storedActiveProposalId,string metadataURI))",
  "event WorkflowRegistered(uint256 indexed workflowId, address indexed owner, string metadataURI)",
]);

const send = process.argv.includes("--send");
// --new-workflow: register a fresh workflow even if one is stored (Upoch workflow names are set at
// registration and cannot be changed afterwards).
const fresh = process.argv.includes("--new-workflow");
// The name and description Upoch's Agent Hub shows (inline data: URI; Upoch does not fetch URLs).
const METADATA = {
  name: "Palisec demo agent",
  agentType: "Palisec smart account (Safe, co-signed by Palisec)",
  description: `Palisec's mainnet demo agent. Its account ${"0x375BdF5DA6b7440889e50f13C894A3C4AC988329"} is enforced by Palisec (see palisec.tech/docs/detect); each demo run commits a checkpoint here.`,
};
const METADATA_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(METADATA)).toString("base64")}`;
const file = process.env.UPOCH_KEY_FILE;
if (!file) throw new Error("Set UPOCH_KEY_FILE to the checkpoint key file.");
const store = JSON.parse(readFileSync(file, "utf8"));
// Upoch requires the workflow's owner and its executor to be different keys: the funded key owns the
// workflow and passes a little gas to the executor key, which posts the checkpoints.
const key = privateKeyToAccount(store.key);
if (!store.executor_key) {
  store.executor_key = generatePrivateKey();
  writeFileSync(file, JSON.stringify(store));
}
const executor = privateKeyToAccount(store.executor_key);
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } };
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: key, chain, transport: http(RPC) });
const execWallet = createWalletClient({ account: executor, chain, transport: http(RPC) });
const balance = await pub.getBalance({ address: key.address });
console.log(`Checkpoint key ${key.address}  balance ${formatEther(balance)} ETH  (UTC ${new Date().toISOString()})`);

// Recovery policy like other Upoch workflows: one guardian approval plus the owner, a 1-day timelock.
const POLICY = [1, true, 0, 86400, 86400, 86400];
let workflowId = store.workflow_id && !fresh ? BigInt(store.workflow_id) : null;
if (workflowId === null) {
  // The demo Safe is listed as an executor too: that is the on-chain link from the workflow to the Palisec
  // smart account that Upoch's "Enforced by Palisec" mark reads. Checkpoints are still posted by the executor key.
  const args = [[executor.address, SAFE], [GUARDIAN], POLICY, METADATA_URI];
  const sim = await pub.simulateContract({ account: key, address: LEDGER, abi: ABI, functionName: "registerWorkflow", args });
  console.log(`Register workflow: simulated OK, would be workflow ${sim.result}`);
  if (!send) process.exit(0);
  if ((await pub.getBalance({ address: executor.address })) < 20_000_000_000_000n) {
    const fund = await wallet.sendTransaction({ to: executor.address, value: 100_000_000_000_000n });
    await pub.waitForTransactionReceipt({ hash: fund });
    console.log(`Gas for the executor ${executor.address}: ${EXPLORER}/tx/${fund}`);
  }
  const hash = await wallet.writeContract(sim.request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error("registerWorkflow failed");
  workflowId = sim.result;
  store.workflow_id = workflowId.toString();
  writeFileSync(file, JSON.stringify(store));
  console.log(`Registered workflow ${workflowId}: ${EXPLORER}/tx/${hash}`);
}

const w = await pub.readContract({ address: LEDGER, abi: ABI, functionName: "getWorkflow", args: [workflowId] });
const latest = await fetch("https://palisec.tech/api/v1/health").then((r) => r.json()).catch(() => null);
const state = { agent: "palisec-demo", account: SAFE, chain_id: 4663, palisec_status: latest?.status ?? "unknown", sequence: Number(w.checkpointCount), at: new Date().toISOString() };
const trace = { step: "demo-run", previous_head: w.headHash };
const dataURI = `data:application/json,${encodeURIComponent(JSON.stringify(state))}`;
const args = [workflowId, w.checkpointCount > 0n ? w.headHash : `0x${"00".repeat(32)}`, keccak256(toHex(JSON.stringify(state))), keccak256(toHex(JSON.stringify(trace))), dataURI];
const sim = await pub.simulateContract({ account: executor, address: LEDGER, abi: ABI, functionName: "submitCheckpoint", args });
console.log(`Workflow ${workflowId}: ${w.checkpointCount} checkpoint(s); next checkpoint simulated OK (sequence ${sim.result})`);
if (!send) process.exit(0);
const hash = await execWallet.writeContract(sim.request);
const r = await pub.waitForTransactionReceipt({ hash });
if (r.status !== "success") throw new Error("submitCheckpoint failed");
console.log(`Checkpoint ${sim.result} committed: ${EXPLORER}/tx/${hash}\nOn Upoch: https://upoch.tech/app/agents/${workflowId}`);

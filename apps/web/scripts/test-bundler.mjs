// A minimal ERC-4337 bundler for tests: executes user operations on a local anvil fork through EntryPoint.handleOps.
// node --experimental-strip-types apps/web/scripts/test-bundler.mjs <anvil url> <port>   (tests only; never deployed)
import http from "node:http";
import { createPublicClient, createWalletClient, decodeEventLog, http as transport, parseAbi } from "viem";

const [, , RPC = "http://127.0.0.1:8545", PORT = "4337"] = process.argv;
const lib = await import(new URL("../src/lib/safe-op.ts", import.meta.url).href);
const { ENTRYPOINT_ABI, SAFE_4337 } = lib;
const pub = createPublicClient({ transport: transport(RPC) });
const [bundler] = await pub.request({ method: "eth_accounts" });
const wallet = createWalletClient({ account: bundler, transport: transport(RPC) });
const EVENT = parseAbi(["event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)"]);
const receipts = new Map();

const pack = (op) => ({
  sender: op.sender,
  nonce: BigInt(op.nonce),
  initCode: "0x",
  callData: op.callData,
  accountGasLimits: `0x${BigInt(op.verificationGasLimit).toString(16).padStart(32, "0")}${BigInt(op.callGasLimit).toString(16).padStart(32, "0")}`,
  preVerificationGas: BigInt(op.preVerificationGas),
  gasFees: `0x${BigInt(op.maxPriorityFeePerGas).toString(16).padStart(32, "0")}${BigInt(op.maxFeePerGas).toString(16).padStart(32, "0")}`,
  paymasterAndData: "0x",
  signature: op.signature,
});

const methods = {
  // What the health check asks: the fork's real chain ID and the one EntryPoint this shim supports.
  async eth_chainId() {
    return `0x${(await pub.getChainId()).toString(16)}`;
  },
  async eth_supportedEntryPoints() {
    return [SAFE_4337.entryPoint];
  },
  async rundler_maxPriorityFeePerGas() {
    return "0x3b9aca00";
  },
  async eth_estimateUserOperationGas([op]) {
    if (!op.signature || op.signature.length !== 2 + 2 * (12 + 130)) throw new Error("estimate: unexpected dummy signature length");
    return { preVerificationGas: "0xc350", verificationGasLimit: "0x30d40", callGasLimit: "0x15f90" };
  },
  async eth_sendUserOperation([op, entryPoint]) {
    if (entryPoint.toLowerCase() !== SAFE_4337.entryPoint.toLowerCase()) throw new Error("unsupported entry point");
    const packed = pack(op);
    try {
      await pub.simulateContract({ account: bundler, address: SAFE_4337.entryPoint, abi: ENTRYPOINT_ABI, functionName: "handleOps", args: [[packed], bundler] });
    } catch (e) {
      throw new Error(`validation failed: ${(e.shortMessage || e.message).split("\n")[0]}`);
    }
    const userOpHash = await pub.readContract({ address: SAFE_4337.entryPoint, abi: ENTRYPOINT_ABI, functionName: "getUserOpHash", args: [packed] });
    const tx = await wallet.writeContract({ chain: null, address: SAFE_4337.entryPoint, abi: ENTRYPOINT_ABI, functionName: "handleOps", args: [[packed], bundler], gas: 3_000_000n });
    const r = await pub.waitForTransactionReceipt({ hash: tx });
    let success = false;
    for (const log of r.logs) {
      try {
        const ev = decodeEventLog({ abi: EVENT, data: log.data, topics: log.topics });
        if (ev.args.userOpHash === userOpHash) success = ev.args.success;
      } catch {}
    }
    receipts.set(userOpHash.toLowerCase(), { success, receipt: { transactionHash: tx } });
    return userOpHash;
  },
  async eth_getUserOperationReceipt([hash]) {
    return receipts.get(hash.toLowerCase()) ?? null;
  },
};

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const { id, method, params } = JSON.parse(body);
    res.setHeader("content-type", "application/json");
    try {
      if (!methods[method]) throw new Error(`method ${method} not supported`);
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result: await methods[method](params) }));
    } catch (e) {
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32500, message: e.message } }));
    }
  })
  .listen(Number(PORT), () => console.log(`bundler shim on ${PORT} -> ${RPC}`));

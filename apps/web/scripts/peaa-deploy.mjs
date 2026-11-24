#!/usr/bin/env node
/**
 * Policy publishing: deploys PolicyEnforcedRegistry v3 with the deterministic deployer (CREATE2, same address on
 * any chain). The address depends only on the salt and the code, so any funded key can send it; the publisher
 * key is used. Keys are read from the company key file outside the repository and are never printed.
 *
 *   (cd contracts && forge build) && node apps/web/scripts/peaa-deploy.mjs address   # compute the address and costs; sends nothing
 *   node apps/web/scripts/peaa-deploy.mjs deploy                    # mainnet: deploy (skipped if already there)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { concat, createPublicClient, createWalletClient, defineChain, formatEther, getContractAddress, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const SALT = keccak256(stringToHex("policy-enforced-accounts registry v3"));

const keys = JSON.parse(readFileSync(`${homedir()}/palisec-pg/registry-keys.json`, "utf8"));
const publisher = privateKeyToAccount(keys.publisher);
const deployer = publisher;
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });
const art = JSON.parse(readFileSync(new URL("../../../contracts/out/PolicyEnforcedRegistry.sol/PolicyEnforcedRegistry.json", import.meta.url), "utf8"));
const initCode = art.bytecode.object;
const address = getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: initCode });

const EXPECTED = process.env.EXPECTED; // once published: the library's REGISTRY_ADDRESSES[4663]
if (EXPECTED && address !== EXPECTED) {
  console.error(`computed ${address}, expected ${EXPECTED}: the contract source or compiler settings changed`);
  process.exit(1);
}
const mode = process.argv[2] ?? "address";
const [code, bal, gasPrice] = await Promise.all([pub.getCode({ address }), pub.getBalance({ address: deployer.address }), pub.getGasPrice()]);
console.log(`registry address   ${address}${code && code !== "0x" ? "  (already deployed)" : ""}`);
console.log(`init code hash     ${keccak256(initCode)}`);
console.log(`deployer           ${deployer.address}  balance ${formatEther(bal)} ETH`);
console.log(`publisher          ${publisher.address}  balance ${formatEther(await pub.getBalance({ address: publisher.address }))} ETH`);
console.log(`gas price          ${Number(gasPrice) / 1e9} gwei`);

if (mode === "address") {
  if (!code || code === "0x") {
    const gas = await pub.estimateGas({ account: deployer.address, to: CREATE2_DEPLOYER, data: concat([SALT, initCode]) }).catch(() => null);
    if (gas) console.log(`deploy estimate    ${gas} gas = ${formatEther(gas * gasPrice)} ETH`);
  }
  process.exit(0);
}
if (mode === "deploy") {
  if (code && code !== "0x") process.exit(0);
  const hash = await wallet.sendTransaction({ to: CREATE2_DEPLOYER, data: concat([SALT, initCode]) });
  const r = await pub.waitForTransactionReceipt({ hash });
  const deployed = await pub.getCode({ address });
  console.log(`deploy tx          ${hash}  status ${r.status}  gas ${r.gasUsed}  code ${deployed && deployed !== "0x" ? "present" : "MISSING"}`);
  process.exit(r.status === "success" && deployed && deployed !== "0x" ? 0 : 1);
}
console.error("mode must be address or deploy");
process.exit(2);

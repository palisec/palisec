#!/usr/bin/env node
/**
 * Policy publishing: deploys PolicyEnforcedRegistry with the deterministic deployer (CREATE2, same address on any
 * chain), then funds the publisher key. The deployer key is read from the company key file outside the
 * repository and is never printed.
 *
 *   (cd contracts && forge build) && node apps/web/scripts/peaa-deploy.mjs address   # compute the address and costs; sends nothing
 *   node apps/web/scripts/peaa-deploy.mjs deploy                    # mainnet: deploy (skipped if already there)
 *   node apps/web/scripts/peaa-deploy.mjs fund                      # mainnet: 0.0002 ETH to the publisher, 0.00003 ETH to the mandate Safe
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { concat, createPublicClient, createWalletClient, defineChain, formatEther, getContractAddress, http, keccak256, parseEther, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC ?? "https://rpc.mainnet.chain.robinhood.com";
const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const CREATE2_DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
export const SALT = keccak256(stringToHex("policy-enforced-accounts registry v1"));
const MANDATE_SAFE = "0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c";

const keys = JSON.parse(readFileSync(`${homedir()}/palisec-pg/registry-keys.json`, "utf8"));
const deployer = privateKeyToAccount(keys.deployer);
const publisher = privateKeyToAccount(keys.publisher);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account: deployer, chain, transport: http(RPC) });
const art = JSON.parse(readFileSync(new URL("../../../contracts/out/PolicyEnforcedRegistry.sol/PolicyEnforcedRegistry.json", import.meta.url), "utf8"));
const initCode = art.bytecode.object;
const address = getContractAddress({ opcode: "CREATE2", from: CREATE2_DEPLOYER, salt: SALT, bytecode: initCode });

const EXPECTED = "0x20D6B38B47F7cb765A2318a1f318ed54a6f87e92"; // published in the library and the ERC
if (address !== EXPECTED) {
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
if (mode === "fund") {
  for (const [to, amount] of [[publisher.address, "0.0002"], [MANDATE_SAFE, "0.00003"]]) {
    const hash = await wallet.sendTransaction({ to, value: parseEther(amount) });
    const r = await pub.waitForTransactionReceipt({ hash });
    console.log(`fund ${to} ${amount} ETH  tx ${hash}  status ${r.status}`);
  }
  process.exit(0);
}
console.error("mode must be address, deploy or fund");
process.exit(2);

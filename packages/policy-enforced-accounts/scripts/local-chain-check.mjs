// End-to-end on a local chain (anvil): deploy the reference registry, declare, publish, then read and
// verify with the library only. Uses anvil's public test accounts. Run: anvil &; node scripts/local-chain-check.mjs
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { REGISTRY_ABI, intentHash, policyHash, readAccount, typedReceipt, verifyReceipt } from "../dist/index.js";

const RPC = process.env.RPC ?? "http://127.0.0.1:8545";
const chain = defineChain({ id: 31337, name: "anvil", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
// anvil's well-known test keys (public; never use on a real chain)
const K = ["0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"];
const [accountKey, publisherKey, receiptKey] = K.map((k) => privateKeyToAccount(k));
const w = (a) => createWalletClient({ account: a, chain, transport: http(RPC) });
const art = JSON.parse(readFileSync(new URL("../../../contracts/out/PolicyEnforcedRegistry.sol/PolicyEnforcedRegistry.json", import.meta.url), "utf8"));
let ok = 0, bad = 0;
const check = (name, cond, extra = "") => { cond ? ok++ : bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + extra}`); };

const hash = await w(accountKey).deployContract({ abi: REGISTRY_ABI, bytecode: art.bytecode.object });
const registry = (await pub.waitForTransactionReceipt({ hash })).contractAddress;
const account = accountKey.address; // the "account" declares itself (a Safe would do this through a Safe transaction)
const send = async (who, functionName, args) => pub.waitForTransactionReceipt({ hash: await w(who).writeContract({ address: registry, abi: REGISTRY_ABI, functionName, args }) });

let st = await readAccount(pub, account, registry);
check("undeclared account reads as not enforced", st.enforced === false && st.policy === null);
await send(accountKey, "declare", [accountKey.address, publisherKey.address, receiptKey.address]);
const doc = { account: { chain_id: 31337, address: account }, version: 1, limits: { max_transaction_value_wei: "1000" } };
const h = policyHash(doc);
await send(publisherKey, "activate", [account, h, 1n, "", "https://example.invalid/schema.json"]);
st = await readAccount(pub, account, registry);
check("declared signers read back", st.enforced && st.publisher === publisherKey.address && st.receiptSigner === receiptKey.address);
check("active policy hash matches the document", st.policy?.policyHash === h && st.policy.version === 1n);
const now = (await pub.getBlock()).timestamp;
const doc2 = { ...doc, version: 2, limits: { max_transaction_value_wei: "2000" } };
await send(publisherKey, "setPending", [account, policyHash(doc2), 2n, now + 3600n, "", ""]);
st = await readAccount(pub, account, registry);
check("pending loosening is visible with its effectiveAt", st.pending?.policyHash === policyHash(doc2) && st.pending.effectiveAt === now + 3600n);
check("current rules keep deciding while pending", st.policy?.policyHash === h);

const intent = { chainId: 31337, account, target: "0x2222222222222222222222222222222222222222", value: 20n, data: "0x" };
const r = { chainId: "31337", registry, account, intentHash: intentHash(intent), decision: "DENY", reasonCode: "OVER_LIMIT", detailCode: "palisec:PS_BUDGET_001", policyHash: h, policyVersion: "1", issuedAt: String(now), expiresAt: String(now + 300n), decisionId: keccak256(stringToHex("local-1")), signer: receiptKey.address, signature: "0x" };
r.signature = await receiptKey.signTypedData(typedReceipt(r));
let v = await verifyReceipt(pub, r, { registry, intent, now });
check("genuine receipt verifies", v.valid, v.problems.join("; "));
v = await verifyReceipt(pub, { ...r, decision: "ALLOW" }, { registry, now });
check("tampered receipt is rejected", !v.valid);
v = await verifyReceipt(pub, { ...r, registry: "0x0000000000000000000000000000000000000001" }, { registry, now });
check("receipt naming another registry is rejected", !v.valid);
v = await verifyReceipt(pub, r, { registry, now: now + 301n });
check("expired receipt is rejected", !v.valid);
v = await verifyReceipt(pub, r, { registry, intent: { ...intent, value: 21n }, now });
check("receipt for another intent is rejected", !v.valid);
const forged = { ...r, signature: await publisherKey.signTypedData(typedReceipt(r)) };
v = await verifyReceipt(pub, forged, { registry, now });
check("receipt signed by another key is rejected", !v.valid);
await send(accountKey, "declare", [accountKey.address, publisherKey.address, publisherKey.address]);
v = await verifyReceipt(pub, r, { registry, now });
check("after rotation, the old key's receipt is rejected by default", !v.valid);
v = await verifyReceipt(pub, r, { registry, now, allowRotatedSigner: true });
check("…and accepted for audits with allowRotatedSigner", v.valid, v.problems.join("; "));
console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad ? 1 : 0);

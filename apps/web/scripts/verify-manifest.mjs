#!/usr/bin/env node
/**
 * Checks the deployment manifests against the chain and the code, so they cannot drift:
 *   - each network's RPC reports the manifest's chain ID;
 *   - every contract in the manifest has code on chain whose keccak256 equals the recorded code hash;
 *   - the addresses the application uses (src/lib/safe-op.ts, src/lib/networks.ts) equal the manifest's.
 *
 *   node --experimental-strip-types apps/web/scripts/verify-manifest.mjs          # verify, exit 1 on any mismatch
 *   node --experimental-strip-types apps/web/scripts/verify-manifest.mjs --write  # fill code hashes from chain (maintainers)
 *
 * Read-only against the chain. No keys, no transactions.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256 } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const write = process.argv.includes("--write");
const { SAFE_4337, SAFE_4337_CHAINS } = await import(new URL("../src/lib/safe-op.ts", import.meta.url).href);
const { NETWORKS } = await import(new URL("../src/lib/networks.ts", import.meta.url).href);

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  -> ${detail}`}`);
};

for (const file of ["robinhood-mainnet.json", "robinhood-testnet.json"]) {
  const path = resolve(repo, "deployments", file);
  const m = JSON.parse(readFileSync(path, "utf8"));
  const net = NETWORKS[m.chain_id];
  check(`${file}: network known to the app`, Boolean(net), m.chain_id);
  check(`${file}: explorer matches the app`, net?.explorer === m.explorer, `${m.explorer} vs ${net?.explorer}`);
  check(`${file}: Safe contracts supported on this chain in the app`, SAFE_4337_CHAINS.includes(m.chain_id));

  const rpc = process.env[m.chain_id === 4663 ? "RH_MAINNET_RPC_URL" : "RH_TESTNET_RPC_URL"] || m.public_rpc;
  const client = createPublicClient({ transport: http(rpc, { timeout: 15000, retryCount: 2 }) });
  const chainId = await client.getChainId();
  check(`${file}: RPC reports chain ${m.chain_id}`, chainId === m.chain_id, chainId);

  for (const c of m.contracts) {
    const appAddress = SAFE_4337[c.app_key];
    if (c.app_key) check(`${file}: ${c.name} address equals the app's`, appAddress?.toLowerCase() === c.address.toLowerCase(), `${c.address} vs ${appAddress}`);
    const code = await client.getCode({ address: c.address });
    const hash = code && code !== "0x" ? keccak256(code) : null;
    if (write) c.code_hash = hash;
    check(`${file}: ${c.name} has code on chain`, hash !== null, c.address);
    check(`${file}: ${c.name} code hash matches the manifest`, hash !== null && hash === c.code_hash, `${hash} vs ${c.code_hash}`);
  }
  if (write) {
    m.verified_at = new Date().toISOString();
    writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  }
}

// Mainnet and testnet must run the same code at the same addresses (the app relies on it).
const main = JSON.parse(readFileSync(resolve(repo, "deployments/robinhood-mainnet.json"), "utf8"));
const test = JSON.parse(readFileSync(resolve(repo, "deployments/robinhood-testnet.json"), "utf8"));
for (const c of main.contracts.filter((x) => x.app_key)) {
  const t = test.contracts.find((x) => x.app_key === c.app_key);
  check(`${c.name}: identical code on mainnet and testnet`, t && t.code_hash === c.code_hash && t.address.toLowerCase() === c.address.toLowerCase());
}

console.log(`\n${failed === 0 ? "manifest verified" : `${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);

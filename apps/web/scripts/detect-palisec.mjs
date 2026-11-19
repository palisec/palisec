#!/usr/bin/env node
/**
 * "Enforced by Palisec": the reference detection function (Phase 6.5, for Upoch and anyone else).
 * Reads only public chain state. An address qualifies only if ALL of these hold:
 *
 *   1. It is a Safe: a proxy whose singleton (storage slot 0) is the Safe v1.4.1 singleton.
 *   2. Exactly 3 owners, threshold exactly 2, and one owner is a Palisec co-signer for that chain.
 *      So no single other key (the agent's) reaches the threshold alone: it needs the co-signer, or
 *      the human recovery owner (the third owner).
 *   3. The only enabled module is the Safe 4337 module (it executes only with owner signatures).
 *      Any other module could move funds without the owners, so it fails the check.
 *   4. No transaction guard is set.
 *
 *   node detect-palisec.mjs                    the demo account, negative examples and crafted cases
 *   node detect-palisec.mjs <address> [chain]  one address (chain 4663 by default)
 */
import { createPublicClient, getAddress, http, parseAbi } from "viem";

export const PALISEC = {
  4663: { cosigners: ["0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7"], rpc: "https://rpc.mainnet.chain.robinhood.com" },
  46630: { cosigners: ["0xc4022a43FeFaeB9Ac6d66Cd6B74B1c8044ca8beD"], rpc: "https://rpc.testnet.chain.robinhood.com" },
};
export const SAFE_SINGLETON = "0x41675C099F32341bf84BFc5382aF534df5C7461a"; // Safe v1.4.1
export const SAFE_4337_MODULE = "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226"; // Safe4337Module v0.3.0
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8"; // keccak256("guard_manager.guard.address")
const SENTINEL = "0x0000000000000000000000000000000000000001";
const ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address start, uint256 pageSize) view returns (address[] array, address next)",
]);
const word2addr = (w) => (w && w !== "0x" ? getAddress(`0x${w.slice(-40)}`) : null);

/** Reads what the rule needs. Pure chain reads; nothing is signed or sent. */
export async function readSafeState(client, address) {
  const code = await client.getCode({ address });
  if (!code || code === "0x") return { isContract: false };
  try {
    const [singleton, guard, owners, threshold, modules] = await Promise.all([
      client.getStorageAt({ address, slot: "0x0" }).then(word2addr),
      client.getStorageAt({ address, slot: GUARD_SLOT }).then(word2addr),
      client.readContract({ address, abi: ABI, functionName: "getOwners" }),
      client.readContract({ address, abi: ABI, functionName: "getThreshold" }),
      client.readContract({ address, abi: ABI, functionName: "getModulesPaginated", args: [SENTINEL, 10n] }),
    ]);
    return { isContract: true, singleton, guard, owners: owners.map((o) => getAddress(o)), threshold: Number(threshold), modules: modules[0].map((m) => getAddress(m)) };
  } catch {
    return { isContract: true, notSafe: true };
  }
}

/** The rule itself, on state already read: { enforced, reason }. */
export function classify(state, chainId) {
  const cosigners = (PALISEC[chainId]?.cosigners ?? []).map((a) => getAddress(a));
  if (!state.isContract) return { enforced: false, reason: "Not a contract: a plain key account, which nothing co-signs." };
  if (state.notSafe || state.singleton !== getAddress(SAFE_SINGLETON)) return { enforced: false, reason: "Not a Safe v1.4.1 proxy." };
  const cosigner = state.owners.find((o) => cosigners.includes(o));
  if (!cosigner) return { enforced: false, reason: "No Palisec co-signer among the owners." };
  if (state.owners.length !== 3 || state.threshold !== 2)
    return { enforced: false, reason: `Owners ${state.owners.length}, threshold ${state.threshold}: only 3 owners with threshold 2 qualify, so no single other key can sign alone.` };
  if (state.modules.length !== 1 || state.modules[0] !== getAddress(SAFE_4337_MODULE))
    return { enforced: false, reason: `Modules ${JSON.stringify(state.modules)}: only the Safe 4337 module may be enabled; another module could move funds without the owners.` };
  if (state.guard && state.guard !== "0x0000000000000000000000000000000000000000") return { enforced: false, reason: `A transaction guard is set (${state.guard}).` };
  return { enforced: true, reason: `Safe with owners [agent, Palisec co-signer ${cosigner}, recovery], threshold 2, only the 4337 module, no guard.` };
}

export async function isEnforcedByPalisec(address, chainId = 4663, client) {
  const c = client ?? createPublicClient({ transport: http(PALISEC[chainId].rpc) });
  const state = await readSafeState(c, getAddress(address));
  return { address: getAddress(address), chainId, ...classify(state, chainId), state };
}

// ---------------------------------------------------------------- CLI
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}` || process.argv[1]?.endsWith("detect-palisec.mjs")) {
  const [addr, chain] = process.argv.slice(2);
  const show = (label, r) => console.log(`${r.enforced ? "TRUE " : "FALSE"}  ${label}  ${r.address ?? ""}\n       ${r.reason}`);
  if (addr) {
    show("", await isEnforcedByPalisec(addr, Number(chain ?? 4663)));
  } else {
    const UTC = new Date().toISOString();
    console.log(`Enforced by Palisec: reference check on Robinhood Chain mainnet (4663), ${UTC}\n`);
    const demo = await isEnforcedByPalisec("0x375BdF5DA6b7440889e50f13C894A3C4AC988329");
    show("Palisec demo smart account", demo);
    show("Ordinary key account (negative)", await isEnforcedByPalisec("0x989EfcD8Ad76E695CFD5ba915b1b12118471c430"));
    show("A contract that is not a Safe: Uniswap SwapRouter02 (negative)", await isEnforcedByPalisec("0xcaf681a66d020601342297493863e78c959e5cb2"));
    // Same Safe, changed the ways an attacker would weaken it (evaluated with the rule on modified state):
    const s = demo.state;
    const others = s.owners.filter((o) => o !== getAddress(PALISEC[4663].cosigners[0]));
    show("Crafted: same Safe with an extra module (negative)", { address: "(modified state)", ...classify({ ...s, modules: [...s.modules, "0x000000000000000000000000000000000000dEaD"] }, 4663) });
    show("Crafted: threshold 1, the agent signs alone (negative)", { address: "(modified state)", ...classify({ ...s, threshold: 1 }, 4663) });
    show("Crafted: a 4th owner, agent + extra key reach 2 without Palisec (negative)", { address: "(modified state)", ...classify({ ...s, owners: [...s.owners, "0x000000000000000000000000000000000000bEEF"] }, 4663) });
    show("Crafted: Palisec co-signer removed (negative)", { address: "(modified state)", ...classify({ ...s, owners: [...others, "0x000000000000000000000000000000000000bEEF"] }, 4663) });
    show("Crafted: a guard set (negative)", { address: "(modified state)", ...classify({ ...s, guard: "0x000000000000000000000000000000000000bEEF" }, 4663) });
    console.log(`\nDemo account on chain: owners ${JSON.stringify(s.owners)}, threshold ${s.threshold}, modules ${JSON.stringify(s.modules)}, guard ${s.guard ?? "none"}, singleton ${s.singleton}`);
  }
}

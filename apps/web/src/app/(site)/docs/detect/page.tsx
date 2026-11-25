import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";
import { SAFE_4337 } from "@/lib/safe-op";

export const metadata: Metadata = {
  title: "Detect a Palisec agent",
  description: "How anyone can verify on chain that an agent's account is enforced by Palisec: the co-signer addresses, the exact rule and a reference function.",
  alternates: { canonical: "/docs/detect" }, openGraph: pageOpenGraph("/docs/detect"),
};

const COSIGNER_MAINNET = "0x628FdA166280b9E2C5E5FBD89fDDDaCe626d8ec7";
const COSIGNER_TESTNET = "0xc4022a43FeFaeB9Ac6d66Cd6B74B1c8044ca8beD";
const GUARD_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";

const TS = `import { createPublicClient, getAddress, http, parseAbi } from "viem";

const COSIGNERS: Record<number, string[]> = {
  4663: ["${COSIGNER_MAINNET}"],
  46630: ["${COSIGNER_TESTNET}"],
};
const SINGLETON = "${SAFE_4337.singleton}"; // Safe v1.4.1
const MODULE = "${SAFE_4337.module}";    // Safe4337Module
const GUARD_SLOT = "${GUARD_SLOT}";
const ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getModulesPaginated(address,uint256) view returns (address[],address)",
]);
const asAddr = (w?: string) => (w && w !== "0x" ? getAddress(\`0x\${w.slice(-40)}\`) : undefined);

export async function isEnforcedByPalisec(rpcUrl: string, chainId: number, account: \`0x\${string}\`) {
  const c = createPublicClient({ transport: http(rpcUrl) });
  const code = await c.getCode({ address: account });
  if (!code || code === "0x") return { enforced: false, reason: "plain key account" };
  try {
    const [slot0, guard, owners, threshold, [modules]] = await Promise.all([
      c.getStorageAt({ address: account, slot: "0x0" }),
      c.getStorageAt({ address: account, slot: GUARD_SLOT }),
      c.readContract({ address: account, abi: ABI, functionName: "getOwners" }),
      c.readContract({ address: account, abi: ABI, functionName: "getThreshold" }),
      c.readContract({ address: account, abi: ABI, functionName: "getModulesPaginated", args: ["0x0000000000000000000000000000000000000001", 10n] }),
    ]);
    if (asAddr(slot0) !== getAddress(SINGLETON)) return { enforced: false, reason: "not a Safe v1.4.1" };
    const cosigners = (COSIGNERS[chainId] ?? []).map((a) => getAddress(a));
    if (!owners.some((o) => cosigners.includes(getAddress(o)))) return { enforced: false, reason: "no Palisec co-signer" };
    if (owners.length !== 3 || threshold !== 2n) return { enforced: false, reason: "owners/threshold allow signing without Palisec" };
    if (modules.length !== 1 || getAddress(modules[0]!) !== getAddress(MODULE)) return { enforced: false, reason: "other module enabled" };
    if (asAddr(guard) && asAddr(guard) !== "0x0000000000000000000000000000000000000000") return { enforced: false, reason: "guard set" };
    return { enforced: true, reason: "Enforced by Palisec" };
  } catch {
    return { enforced: false, reason: "not a Safe" };
  }
}`;

export default function DetectPage() {
  return (
    <DocArticle
      title="Detect a Palisec agent"
      lede="Anyone can check on chain, without asking Palisec, whether an agent's account is enforced by Palisec: its key alone cannot move funds."
      maturity="service"
      compat="Robinhood Chain 4663 · 46630"
    >
      <h2 id="cosigners">Palisec co-signers</h2>
      <table>
        <thead><tr><th>Network</th><th>Co-signer address</th></tr></thead>
        <tbody>
          <tr><td>Robinhood Chain mainnet (4663)</td><td className="font-mono text-[0.75rem] text-fg">{COSIGNER_MAINNET}</td></tr>
          <tr><td>Robinhood Chain testnet (46630)</td><td className="font-mono text-[0.75rem] text-fg">{COSIGNER_TESTNET}</td></tr>
        </tbody>
      </table>
      <p>
        One fixed address per network. It does not rotate on its own: a new co-signer would have to be added as an owner of
        every account by its owners, so any change is announced here and in the changelog in advance, with both addresses
        valid during the change. The co-signer is what identifies a Palisec account: the Safe contracts themselves are the
        standard ones anyone can deploy (singleton <code>{SAFE_4337.singleton}</code>, factory{" "}
        <code>{SAFE_4337.proxyFactory}</code>, 4337 module <code>{SAFE_4337.module}</code>).
      </p>

      <h2 id="rule">The rule</h2>
      <p>An address is <strong>Enforced by Palisec</strong> only if all of these hold, read from chain:</p>
      <ol>
        <li><strong>It is a Safe:</strong> storage slot 0 (the proxy&apos;s singleton) is the Safe v1.4.1 singleton.</li>
        <li><strong>Exactly 3 owners and a threshold of exactly 2</strong>, one of them the Palisec co-signer for that network. The other two are the agent&apos;s key and a human recovery owner, so the agent&apos;s key never reaches the threshold alone.</li>
        <li><strong>Only the Safe 4337 module</strong> is enabled (<code>getModulesPaginated(0x…01, 10)</code>). Another module could execute without the owners&apos; signatures.</li>
        <li><strong>No guard</strong> is set (storage slot <code>{GUARD_SLOT.slice(0, 10)}…</code> is zero).</li>
      </ol>
      <p>Anything else (four owners, threshold 1 or 3, no co-signer, an extra module, a guard, a plain key account) is not enforced.</p>
      <Note kind="note" title="What the badge proves">
        That every transaction from the account needs the Palisec co-signer, which signs only what the agent&apos;s policy
        allowed, or the human recovery owner. It does not prove what that policy allows (limits, allowlists).
      </Note>

      <h2 id="reference">Reference function</h2>
      <p>TypeScript with viem. Returns <code>enforced</code> and the reason. Read-only: nothing is signed or sent.</p>
      <CodeBlock code={TS} title="isEnforcedByPalisec.ts" />

      <h2 id="example">Example</h2>
      <p>
        The Palisec demo smart account <code>0x375BdF5DA6b7440889e50f13C894A3C4AC988329</code> on mainnet returns{" "}
        <code>true</code>. An ordinary key account such as <code>0x989EfcD8Ad76E695CFD5ba915b1b12118471c430</code>, or any
        contract that is not a Safe, returns <code>false</code>.
      </p>
    </DocArticle>
  );
}

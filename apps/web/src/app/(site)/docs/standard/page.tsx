import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";
import { REASONS, REGISTRY_ADDRESSES } from "policy-enforced-accounts";

export const metadata: Metadata = {
  title: "Standard: Policy-Enforced Agent Accounts",
  description: "A draft ERC for reading, from the chain alone, whether an agent's account is protected by a policy signer, which policy is active, why a transaction was refused, and whether a decision receipt is genuine.",
  alternates: { canonical: "/docs/standard" }, openGraph: pageOpenGraph("/docs/standard"),
};

const REGISTRY = REGISTRY_ADDRESSES[4663]!;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const DEMO = "0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c";

const IFACE = `interface IPolicyEnforcedAccount {            // ERC-165 id 0xcc16d336
  struct Signers { address policySigner; address publisher; address receiptSigner; uint64 since; }
  struct PolicyCommitment { bytes32 policyHash; uint64 version; uint64 effectiveAt; string policyURI; string schemaURI; }

  function policySigner(address account) external view returns (Signers memory);
  function signersAt(address account, uint64 timestamp) external view returns (Signers memory);
  function policyOf(address account) external view returns (PolicyCommitment memory);
  function pendingPolicyOf(address account) external view returns (bool exists, PolicyCommitment memory);
  function mandateOf(address account) external view returns (string memory mandateURI, bytes32 configHash);
  function isStopped(address account) external view returns (bool);

  event SignersDeclared(address indexed account, address policySigner, address publisher, address receiptSigner);
  event PolicyActivated(address indexed account, bytes32 indexed policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI);
  event PolicyPending(address indexed account, bytes32 indexed policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI);
  event PolicyCancelled(address indexed account, bytes32 indexed policyHash, uint64 version, string reason);
  event EmergencyStop(address indexed account, string reason);
  event EmergencyStopLifted(address indexed account);
  event MandateSet(address indexed account, string mandateURI, bytes32 configHash);
}`;

const RECEIPT = `EIP712Domain { name: "PolicyDecisionReceipt", version: "1", chainId, verifyingContract: <registry> }

Decision(address account, bytes32 intentHash, uint8 decision, bytes32 reasonCode, bytes32 detailCode,
         bytes32 policyHash, uint64 policyVersion, uint64 issuedAt, uint64 expiresAt, bytes32 decisionId)
  decision: 0 ALLOW · 1 DENY · 2 REVIEW

intentHash = keccak256(abi.encode(
  keccak256("Intent(uint256 chainId,address account,address target,uint256 value,bytes32 dataHash)"),
  chainId, account, target, value, keccak256(data)))`;

const READ = `npm install policy-enforced-accounts viem

import { createPublicClient, http } from "viem";
import { REGISTRY_ADDRESSES, fetchPolicy, readAccount, verifyReceipt } from "policy-enforced-accounts";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const s = await readAccount(client, "${DEMO}", REGISTRY_ADDRESSES[4663]);
console.log(s.enforced, s.policySigner, s.policy?.policyHash, s.pending?.effectiveAt);
console.log((await fetchPolicy(s.policy)).matches);            // the document matches the on-chain hash
console.log((await verifyReceipt(client, receipt)).valid);    // a decision receipt, checked against the chain`;

export default function StandardPage() {
  return (
    <DocArticle
      title="Policy-Enforced Agent Accounts"
      lede="A draft ERC, with a live reference implementation: anyone can check from the chain alone whether an agent's account is protected by a policy signer, which policy is active, why something was refused, and whether a decision receipt is genuine."
      maturity="service"
      compat="Draft ERC · Robinhood Chain 4663"
    >
      <h2 id="why">Why</h2>
      <p>
        Apps, wallets, lenders and marketplaces that deal with an agent have no common way to see whether its account is protected, what
        limits apply, or whether a looser policy is about to take effect. This standard is a read and evidence layer on top of whatever
        enforces: an external co-signer like Palisec, an account module, a guard. It does not define how a policy is evaluated.
      </p>

      <h2 id="live">Reference implementation (live)</h2>
      <table>
        <tbody>
          <tr><td>Registry (mainnet 4663)</td><td><a href={`${EXPLORER}/address/${REGISTRY}?tab=contract`} className="font-mono text-[12px]">{REGISTRY}</a> · source verified, no owner, no upgrade path, holds no funds</td></tr>
          <tr><td>ERC-165 interface id</td><td><code>0xcc16d336</code></td></tr>
          <tr><td>Deployment</td><td>Deterministic deployer <code>0x4e59b448…956C</code>, salt <code>keccak256(&quot;policy-enforced-accounts registry v1&quot;)</code></td></tr>
          <tr><td>Demo account</td><td><a href={`${EXPLORER}/address/${DEMO}`} className="font-mono text-[12px]">{DEMO}</a> (Palisec smart account, holder mandate)</td></tr>
          <tr><td>Client library</td><td><code>policy-enforced-accounts</code> (TypeScript, viem; CC0)</td></tr>
          <tr><td>Test vectors</td><td><a href="/standard/vectors.json">vectors.json</a>, checked in TypeScript and Solidity</td></tr>
          <tr><td>Independent read test</td><td><a href="/standard/independent-read.mjs">independent-read.mjs</a>: no Palisec API, no keys</td></tr>
        </tbody>
      </table>

      <h2 id="interface">Interface</h2>
      <p>
        A reader calls <code>supportsInterface(0xcc16d336)</code> on the account. If the account does not serve the interface, the reader
        asks the registry. Existing accounts such as Safes opt in by calling <code>declare(policySigner, publisher, receiptSigner)</code>{" "}
        themselves. After that, only their declared publisher can post their commitments, and nobody can write another account&apos;s data.
      </p>
      <CodeBlock code={IFACE} title="IPolicyEnforcedAccount.sol" />
      <ul>
        <li><strong>policyHash</strong> is keccak256 of the policy document&apos;s RFC 8785 canonical JSON. If <code>policyURI</code> is set, anyone can fetch the document and check it.</li>
        <li><strong>A pending loosening</strong> is public with its <code>effectiveAt</code>, and the registry switches to it by time alone, so readers are right even if the publisher is late.</li>
        <li><strong>Publisher and receipt keys</strong> are separate from the co-signer: neither can move funds.</li>
      </ul>

      <h2 id="reasons">Reason codes</h2>
      <p>ASCII identifiers right-padded to <code>bytes32</code>. The list is append-only, and an identifier is never reused. Vendor codes go in a separate <code>detailCode</code>, for example <code>palisec:PS_BUDGET_001</code>.</p>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
        <tbody>
          {Object.entries(REASONS).map(([k, v]) => (
            <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="receipts">Decision receipts</h2>
      <p>
        Every Palisec decision for an opted-in account returns a <code>receipt</code> field: an EIP-712 signature by the account&apos;s
        declared receipt signer, bound to the exact intent, the policy hash and an expiry. Verify it against the registry, not against
        Palisec.
      </p>
      <CodeBlock code={RECEIPT} title="Receipt (EIP-712)" />

      <h2 id="read">Read any account</h2>
      <CodeBlock code={READ} title="read.mjs" />
      <Note kind="note" title="What it does not guarantee">
        A commitment proves what the publisher stated, not that the policy signer follows it; receipts are the evidence. Whether a policy is
        safe is up to its owner. Also check the account&apos;s own configuration (for Palisec accounts: <a href="/docs/detect">Detect a Palisec agent</a>).
      </Note>
    </DocArticle>
  );
}

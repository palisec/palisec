import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";
import { REASONS, REGISTRY_ADDRESSES, REGISTRY_V1_ADDRESSES, REGISTRY_V2_ADDRESSES } from "policy-enforced-accounts";

export const metadata: Metadata = {
  title: "Standard: Policy-Enforced Agent Accounts",
  description: "ERC-8511 (draft) for reading, from the chain alone, whether an agent's account is protected by a policy signer, which policy is active, why a transaction was refused, and whether a decision receipt is genuine.",
  alternates: { canonical: "/docs/standard" }, openGraph: pageOpenGraph("/docs/standard"),
};

const REGISTRY = REGISTRY_ADDRESSES[4663]!;
const REGISTRY_V1 = REGISTRY_V1_ADDRESSES[4663]!;
const REGISTRY_V2 = REGISTRY_V2_ADDRESSES[4663]!;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const DEMO = "0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c";

const IFACE = `interface IPolicyEnforcedAccount {            // ERC-165 id 0xf594edcd
  struct Signers {
    address policySigner; address publisher; address receiptSigner; uint64 since;
    uint32 minDelay;      // seconds every publisher change and every later signer change waits
    uint8 signerType;     // 1 co-signer · 2 validator module · 3 guard or hook · 4 other
  }
  struct PolicyCommitment { bytes32 policyHash; uint64 version; uint64 effectiveAt; string policyURI; string schemaURI; }

  function policySigner(address account) external view returns (Signers memory);
  function signersAt(address account, uint64 timestamp) external view returns (Signers memory);
  function pendingSignersOf(address account) external view returns (bool exists, Signers memory);
  function policyOf(address account) external view returns (PolicyCommitment memory);
  function pendingPolicyOf(address account) external view returns (bool exists, PolicyCommitment memory);
  function mandateOf(address account) external view returns (string memory mandateURI, bytes32 configHash);
  function isStopped(address account) external view returns (bool);
  function stopHeldByAccount(address account) external view returns (bool); // only the account can lift it

  event SignersDeclared(address indexed account, address policySigner, address publisher, address receiptSigner, uint32 minDelay, uint8 signerType);
  event SignersPending(address indexed account, address policySigner, address publisher, address receiptSigner, uint32 minDelay, uint8 signerType, uint64 effectiveAt);
  event SignersCancelled(address indexed account, address policySigner, address publisher, address receiptSigner, uint64 effectiveAt);
  event PolicyActivated(address indexed account, bytes32 indexed policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI);
  event PolicyPending(address indexed account, bytes32 indexed policyHash, uint64 version, uint64 effectiveAt, string policyURI, string schemaURI);
  event PolicyCancelled(address indexed account, bytes32 indexed policyHash, uint64 version, string reason);
  event EmergencyStop(address indexed account, string reason);
  event EmergencyStopLifted(address indexed account);
  event MandateSet(address indexed account, string mandateURI, bytes32 configHash);
}`;

const RECEIPT = `EIP712Domain { name: "PolicyDecisionReceipt", version: "2", chainId, verifyingContract: <registry> }

Decision(address account, bytes32 intentHash, uint8 decision, bytes32 reasonCode, bytes32 detailCode,
         bytes32 policyHash, uint64 policyVersion, uint64 issuedAt, uint64 expiresAt, bytes32 decisionId)
  decision: 0 ALLOW · 1 DENY · 2 REVIEW

intentHash = keccak256(abi.encode(
  keccak256("Intent(uint256 chainId,address account,address target,uint256 value,bytes32 dataHash,uint8 operation)"),
  chainId, account, target, value, keccak256(data), operation))
  operation: 0 call · 1 delegatecall (ERC-7579: the call type byte of the execution mode)`;

const READ = `npm install policy-enforced-accounts viem

import { createPublicClient, http } from "viem";
import { REGISTRY_ADDRESSES, fetchPolicy, readAccount, verifyReceipt } from "policy-enforced-accounts";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const s = await readAccount(client, "${DEMO}", REGISTRY_ADDRESSES[4663]);
console.log(s.enforced, s.policySigner, s.minDelay, s.policy?.policyHash, s.pending?.effectiveAt);
console.log((await fetchPolicy(s.policy)).matches);            // the document matches the on-chain hash
console.log((await verifyReceipt(client, receipt)).valid);    // a decision receipt, checked against the chain (an audit)

// Acting on an ALLOW (a gate): also the current policy, no stop, and a decisionId never used before
const gate = await verifyReceipt(client, receipt, { intent, use: true, seen: myUsedIdsStore });`;

export default function StandardPage() {
  return (
    <DocArticle
      title="Policy-Enforced Agent Accounts"
      lede="ERC-8511 (draft), with a live reference implementation: anyone can check from the chain alone whether an agent's account is protected by a policy signer, which policy is active, why something was refused, and whether a decision receipt is genuine."
      maturity="service"
      compat="ERC-8511 (draft) · Robinhood Chain 4663"
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
          <tr><td>Specification</td><td>ERC-8511 (draft): <a href="https://github.com/ethereum/ERCs/pull/2196">ethereum/ERCs #2196</a> · discussion on <a href="https://ethereum-magicians.org/t/erc-8511-policy-enforced-agent-accounts/30467">Ethereum Magicians</a></td></tr>
          <tr><td>Registry v3 (mainnet 4663)</td><td><a href={`${EXPLORER}/address/${REGISTRY}?tab=contract`} className="font-mono text-[0.75rem]">{REGISTRY}</a> · source verified, no owner, no upgrade path, holds no funds</td></tr>
          <tr><td>ERC-165 interface id</td><td><code>0xf594edcd</code></td></tr>
          <tr><td>Deployment</td><td>Deterministic deployer <code>0x4e59b448…956C</code>, salt <code>keccak256(&quot;policy-enforced-accounts registry v3&quot;)</code></td></tr>
          <tr><td>Registry v2</td><td><a href={`${EXPLORER}/address/${REGISTRY_V2}?tab=contract`} className="font-mono text-[0.75rem]">{REGISTRY_V2}</a> · interface <code>0x7e0f19f9</code>; kept as it is and readable, and its receipts verify like v3&apos;s (domain version &quot;2&quot;). There a publisher can lift a stop the account engaged.</td></tr>
          <tr><td>First draft (v1)</td><td><a href={`${EXPLORER}/address/${REGISTRY_V1}?tab=contract`} className="font-mono text-[0.75rem]">{REGISTRY_V1}</a> · interface <code>0xcc16d336</code>; kept as it is, readable, and its receipts still verify (domain version &quot;1&quot;)</td></tr>
          <tr><td>Demo account</td><td><a href={`${EXPLORER}/address/${DEMO}`} className="font-mono text-[0.75rem]">{DEMO}</a> (Palisec smart account, holder mandate)</td></tr>
          <tr><td>Client library</td><td><code>policy-enforced-accounts</code> (TypeScript, viem; CC0)</td></tr>
          <tr><td>Test vectors</td><td><a href="/standard/vectors.json">vectors.json</a> (v3; receipts as in v2) and <a href="/standard/vectors-v1.json">vectors-v1.json</a>, checked in TypeScript and Solidity</td></tr>
          <tr><td>Independent read test</td><td><a href="/standard/independent-read.mjs">independent-read.mjs</a>: no Palisec API, no keys</td></tr>
        </tbody>
      </table>

      <h2 id="interface">Interface</h2>
      <p>
        A reader calls <code>supportsInterface(0xf594edcd)</code> on the account. If the account does not serve the interface, the reader
        asks the registry. Existing accounts such as Safes opt in by calling{" "}
        <code>declare(policySigner, publisher, receiptSigner, minDelay, signerType)</code> themselves. After that, only their declared
        publisher can post their commitments, and nobody can write another account&apos;s data.
      </p>
      <CodeBlock code={IFACE} title="IPolicyEnforcedAccount.sol" />
      <ul>
        <li><strong>policyHash</strong> is keccak256 of the policy document&apos;s RFC 8785 canonical JSON. If <code>policyURI</code> is set, anyone can fetch the document and check it.</li>
        <li><strong>A pending change</strong> is public with its <code>effectiveAt</code>, and the registry switches to it by time alone, so readers are right even if the publisher is late.</li>
        <li><strong>Publisher and receipt keys</strong> are separate from the co-signer: neither can move funds.</li>
      </ul>

      <h2 id="time">Time rules</h2>
      <p>
        The registry cannot tell a tightening from a loosening, so its rules are about time. The account chooses a{" "}
        <code>minDelay</code> (Palisec accounts: 15 minutes; at most 30 days).
      </p>
      <ul>
        <li><strong>Every policy the publisher posts waits.</strong> It goes in with <code>setPending</code> at least <code>minDelay</code> ahead, and decides from its <code>effectiveAt</code>. Confirming it earlier reverts. Only the account itself (its owners) may activate a policy at once.</li>
        <li><strong>Signer changes wait too.</strong> After the first declaration, a new signer set applies <code>minDelay</code> later (lowering <code>minDelay</code> included), and the account can cancel it meanwhile. Clearing to all zeros applies at once: it only removes the claim of enforcement.</li>
        <li><strong>Every removal of a pending policy</strong> (replaced, superseded or cancelled) emits <code>PolicyCancelled</code>.</li>
        <li><strong>The emergency stop</strong> only restricts, so the publisher or the account engages it at once. A stop the account engaged
          is held: only the account can lift it, so a leaked publisher key cannot undo the account&apos;s own way out. A stop the publisher
          engaged can be lifted by either, and the account can take it over by engaging it too (<code>stopHeldByAccount</code>).</li>
        <li><strong>Palisec follows the account&apos;s stop:</strong> while the account holds its stop on the registry, Palisec co-signs nothing
          that adds risk (<code>PS_PAUSED_001</code>); only withdrawals to the policy&apos;s exit addresses stay allowed. The registry is read
          before every decision, and an unreadable registry fails closed (<code>PS_STATE_001</code>). The account lifts the stop with its
          own owners, since Palisec does not co-sign the lift.</li>
        <li><strong>Who the delay binds:</strong> <code>minDelay</code> binds the publisher. The account&apos;s own authority is immediate: it can
          activate a policy at once, or clear its signers and declare new ones in one transaction. Both are public events. A policy that allowlists
          the registry&apos;s <code>declare</code> or <code>activate</code> gives the agent that authority; Palisec&apos;s demo accounts allow it only
          while they move to a new registry.</li>
      </ul>
      <p>
        Palisec applies a tightening off chain at once, because stricter is always safe. The registry shows it after <code>minDelay</code>; until
        then receipts carry the newer policy version.
      </p>

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
        Every recorded Palisec decision for an opted-in account returns a <code>receipt</code> field (dry runs do not): an EIP-712 signature by the account&apos;s
        declared receipt signer, bound to the exact intent, the policy hash and an expiry. Verify it against the registry, not against
        Palisec.
      </p>
      <CodeBlock code={RECEIPT} title="Receipt (EIP-712)" />
      <p>
        <strong>Acting on a receipt.</strong> A verifier that acts on an ALLOW (a gate, not an audit) must also check, at use time, that the
        receipt&apos;s <code>policyHash</code> and <code>policyVersion</code> are the registry&apos;s current policy, that the account is not
        stopped, and that the <code>decisionId</code> was never used before. The library does this with <code>verifyReceipt(…, {"{"} use: true, seen {"}"})</code>.
      </p>

      <h2 id="read">Read any account</h2>
      <CodeBlock code={READ} title="read.mjs" />
      <Note kind="note" title="What it does not guarantee">
        A commitment proves what the publisher stated, not that the policy signer follows it; receipts are the evidence. Whether a policy is
        safe is up to its owner. A commitment covers only actions that need the policy signer: standing authority does not. Check it
        separately: token allowances and permits, operator approvals, modules and executors, guards and hooks, fallback handlers, and an
        ERC-7702 delegation target (for Palisec accounts: <a href="/docs/detect">Detect a Palisec agent</a>).
      </Note>
    </DocArticle>
  );
}

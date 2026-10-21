import type { Metadata } from "next";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Account abstraction",
  description: "How Palisec enforces authorization on chain through an ERC-4337 smart-account validation module.",
  alternates: { canonical: "/docs/account-abstraction" },
};

const LIFECYCLE = [
  "The SDK constructs a UserOperation for the supported account and chain.",
  "Palisec evaluates it against the active policy and authoritative state.",
  "An ALLOW produces a short-lived authorization bound to the operation hash, account, chain, policy version and expiry.",
  "If approval is required, the operation waits unsigned and unsubmitted.",
  "The signing service signs only the exact approved payload.",
  "The bundler validates and submits the UserOperation.",
  "Palisec tracks inclusion, execution outcome, gas cost and finality.",
  "The reservation is reconciled and the audit record is updated.",
];

const BINDING = [
  ["Smart account + chain ID", "Prevents cross-account and cross-chain reuse."],
  ["Target + selector", "The approval covers one method on one contract."],
  ["Value + decoded parameters", "What the approver actually saw."],
  ["Operation hash", "Any change to the operation invalidates the approval."],
  ["Policy version", "Activating a new version invalidates it."],
  ["Request + reservation ID", "Links approval to budget state."],
  ["Approver identity", "Independent wallet signature, recorded."],
  ["Expiry + one-time use", "Cannot be replayed or reused."],
];

export default function AccountAbstraction() {
  return (
    <DocArticle
      title="Account abstraction"
      lede="The first release has one protected execution path: an ERC-4337 smart account with a Palisec validation module. Off-chain approval alone is never enough."
      maturity="specified"
      compat="ERC-4337 · entry point to be confirmed for Robinhood Chain"
    >
      <h2 id="why">Why on-chain enforcement</h2>
      <p>
        If an agent keeps an unrestricted private key, it can bypass any off-chain firewall by broadcasting directly. The
        account&apos;s validation logic must reject any operation that lacks a valid authorization from a registered Palisec
        signer. Plain EOA forwarding may be offered for convenience, but it is not a security boundary and is never presented as
        one.
      </p>
      <p>
        The module builds on an audited smart-account implementation rather than a custom wallet. It contains signer
        registration, rotation and revocation, nonce-based replay protection, a human-approval validation path, emergency pause,
        and events for every security-relevant change.
      </p>

      <h2 id="lifecycle">UserOperation lifecycle</h2>
      <ol>{LIFECYCLE.map((s) => <li key={s}>{s}</li>)}</ol>

      <h2 id="approvals">Human approval binding</h2>
      <p>The approver signs the actual operation, not a notification. The approval record binds:</p>
      <table>
        <thead><tr><th>Bound field</th><th>Why</th></tr></thead>
        <tbody>{BINDING.map(([f, w]) => <tr key={f}><td className="text-fg">{f}</td><td>{w}</td></tr>)}</tbody>
      </table>
      <p>A human signature approves one operation. It never grants the agent blanket permission.</p>

      <h2 id="compatibility">Chain compatibility checks before mainnet</h2>
      <Note kind="warning" title="Unverified">
        Chain IDs 4663 (mainnet) and 46630 (testnet) come from the specification and must be confirmed against authoritative
        network configuration. The supported entry point, bundler compatibility, fee estimation methods and deployment process
        are also unconfirmed.
      </Note>
    </DocArticle>
  );
}

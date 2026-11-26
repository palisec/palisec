import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";

export const metadata: Metadata = {
  title: "Treasury guard",
  description:
    "Anti-rug rules for an agent's treasury of its own token: where the token may go, a daily sell cap, exact approvals, protected liquidity and a lock date that nobody can loosen before it passes. Enforced by Palisec's co-signature and published on chain.",
  alternates: { canonical: "/docs/treasury-guard" },
  openGraph: pageOpenGraph("/docs/treasury-guard"),
};

const EXAMPLE = `"schema_version": "1.6",
"treasury_guard": {
  "enabled": true,
  "project_token": "0x…your project token",
  "allowed_destinations": ["0x…vesting contract"],
  "allowed_sell_venues": ["0x…bonding curve or pool"],
  "daily_sell_cap": {
    "amount": "2000000000000000000000",   // 2,000 tokens (18 decimals); null = not used
    "pct_of_holdings_bps": 100            // 1% of holdings; null = not used
  },
  "approvals": "exact_to_venues",
  "protect_liquidity": true,
  "lp_tokens": ["0x…LP token"],
  "locked_until": 1798761600              // unix seconds, UTC; 0 = not locked
}`;

const VERIFY = `import { createPublicClient, http } from "viem";
import { fetchPolicy, readAccount, REGISTRY_ADDRESSES } from "policy-enforced-accounts";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
// The account's current policy commitment on the ERC-8511 registry (v3).
const status = await readAccount(client, "0x…agent account", REGISTRY_ADDRESSES[4663]);
// Fetches the policy document and checks its hash against the commitment.
const { document, matches } = await fetchPolicy(status.policy);
console.log(matches, status.policy.version, document.treasury_guard);`;
export default function TreasuryGuardDocsPage() {
  return (
    <DocArticle
      title="Treasury guard"
      lede="Agent tokens often sit in the agent's own treasury, and holders' biggest fear is that the treasury gets dumped or sent to insiders. A treasury guard puts anti-rug rules on that treasury: Palisec's co-signer enforces them on every transaction, and anyone can check them on chain."
      maturity="service"
      compat="Policy schema 1.6 · Robinhood Chain 4663"
    >
      <h2 id="what-it-does">What it does</h2>
      <ul>
        <li><strong>Destinations.</strong> The project token can only go to an allowed destination (for example a vesting contract) or an allowed sell venue. A transfer anywhere else is <code>PS_TREASURY_001</code>.</li>
        <li><strong>A daily sell cap.</strong> The agent can sell at most an amount, or a share of its holdings, per rolling 24 hours. The sell that would cross it is <code>PS_TREASURY_002</code>.</li>
        <li><strong>No sneaky approvals.</strong> The project token can only be approved to a sell venue, never unlimited, and never for more than the cap has left. Anything else is <code>PS_TREASURY_003</code>.</li>
        <li><strong>No pulling liquidity.</strong> With <code>protect_liquidity</code> on, the listed LP tokens can never leave the account or be approved: <code>PS_TREASURY_004</code>.</li>
        <li><strong>A lock.</strong> Until <code>locked_until</code>, nobody can loosen the rules: not the API, not the console, not a holder vote. A loosening change is rejected with <code>PS_TREASURY_005</code>, never queued. Tightening always applies at once.</li>
      </ul>

      <h2 id="policy">The policy section</h2>
      <p>Add <code>treasury_guard</code> to the policy and set <code>schema_version</code> to &quot;1.6&quot;. It is off unless you add it.</p>
      <CodeBlock code={EXAMPLE} />
      <table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>project_token</code></td><td>The token the rules protect.</td></tr>
          <tr><td><code>allowed_destinations</code></td><td>Where the token may be sent, up to 32 addresses. Transfers there are not sells.</td></tr>
          <tr><td><code>allowed_sell_venues</code></td><td>Routers, pools or bonding curves. Tokens sent to them count as sells toward the cap.</td></tr>
          <tr><td><code>daily_sell_cap</code></td><td>An <code>amount</code> in base units and/or <code>pct_of_holdings_bps</code>; with both, the smaller applies. Holdings are the balance before the window&apos;s sells, so each sell does not shrink the cap.</td></tr>
          <tr><td><code>approvals</code></td><td>Always <code>&quot;exact_to_venues&quot;</code>.</td></tr>
          <tr><td><code>protect_liquidity</code>, <code>lp_tokens</code></td><td>When on, the listed ERC-20 LP tokens never leave the account and are never approved.</td></tr>
          <tr><td><code>locked_until</code></td><td>Unix seconds (UTC). Before it, loosening this section is rejected.</td></tr>
        </tbody>
      </table>

      <h2 id="detection">How a transaction is read</h2>
      <p>
        Palisec does not trust what a call claims to do. Every call is simulated on current chain state, including calls
        without a function selector, and the guard reads every transfer of the project token out of the account. Direct
        transfers, routers, multicalls, aggregators and unknown contracts are all judged by what they actually move. If the
        movement cannot be determined (no simulation, a revert, a stale result), the request is denied with{" "}
        <code>PS_SIM_002</code>.
      </p>
      <p>
        Sells are counted per account over a rolling 24 hours, across every agent and policy on that account, so switching
        agents does not reset the window. The cap is checked again in the same database step that records the decision, so
        simultaneous requests cannot sell past it together.
      </p>

      <h2 id="lock">The lock and holder mandates</h2>
      <ul>
        <li><strong>Before <code>locked_until</code>:</strong> any change that loosens the section is rejected with <code>PS_TREASURY_005</code>: raising or removing the cap, adding a destination or venue, unprotecting liquidity, shortening the lock, switching the guard off or removing it.</li>
        <li><strong>Holder votes</strong> cannot loosen a locked guard: such a proposal does not open, and a vote that passes is checked again before it applies.</li>
        <li><strong>Every policy on the account</strong> must keep the lock: a second agent under a policy without the guard, or moving the agent to one, is rejected. Changes already waiting in the loosening delay count too.</li>
        <li><strong>Tightening</strong> (a lower cap, fewer destinations, a later lock) applies at once. <strong>After the lock date</strong>, loosening follows the normal <Link href="/docs/policies#loosening-delay">loosening delay</Link>.</li>
        <li>Every change is published through the ERC-8511 registry (v3).</li>
      </ul>

      <h2 id="codes">Reason codes</h2>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th><th>ERC-8511</th></tr></thead>
        <tbody>
          <tr><td><code>PS_TREASURY_001</code></td><td>Destination not allowed for the project token</td><td><code>DENY_RULE</code></td></tr>
          <tr><td><code>PS_TREASURY_002</code></td><td>Daily sell cap reached (retryable once the window moves)</td><td><code>OVER_BUDGET</code></td></tr>
          <tr><td><code>PS_TREASURY_003</code></td><td>Approval not allowed: unlimited, wrong spender or more than the cap has left</td><td><code>APPROVAL_RISK</code></td></tr>
          <tr><td><code>PS_TREASURY_004</code></td><td>Liquidity removal blocked</td><td><code>DENY_RULE</code></td></tr>
          <tr><td><code>PS_TREASURY_005</code></td><td>The guard is locked: loosening is rejected (a policy change, not a decision)</td><td><code>DENY_RULE</code></td></tr>
        </tbody>
      </table>
      <p>Receipts carry the detail code as <code>palisec:PS_TREASURY_00x</code>. All codes: <Link href="/docs/errors">reason codes</Link>.</p>

      <h2 id="verify">Verify from the chain</h2>
      <p>
        The policy&apos;s hash, version and URI are on the ERC-8511 registry, so anyone can check the rules without trusting
        Palisec: read the commitment, fetch the document, hash it and compare, then read <code>treasury_guard</code> and its
        lock date from the document.
      </p>
      <CodeBlock code={VERIFY} />

      <h2 id="limits">What it does not cover</h2>
      <p>
        The guard binds every transaction Palisec co-signs, which is everything the agent does through Palisec. A Palisec
        account is a Safe with three owners and a threshold of two: the agent&apos;s key, the Palisec co-signer and a human
        recovery owner (<Link href="/docs/detect">how to check</Link>). The recovery owner together with the agent&apos;s key
        can still sign without Palisec. Holders who want the guard to bind the team as well should check who holds the
        recovery owner key; the owners are readable on chain.
      </p>
      <p>Each protected agent&apos;s public page (<code>/r/&lt;account&gt;</code>) reads the owners from the chain and shows one of:</p>
      <ul>
        <li><strong>The team can bypass these rules with its recovery key</strong>: both non-Palisec owners are ordinary keys.</li>
        <li><strong>Fully bound</strong>: the recovery owner is a timelock whose minimum delay is at least the time left on the lock, so any attempt to sign without Palisec is scheduled in public on chain and cannot run before the lock ends.</li>
        <li><strong>Check the contract owner</strong>: the recovery owner is a contract that is not such a timelock.</li>
      </ul>

      <h2 id="fully-bound">Making it fully bound</h2>
      <ol>
        <li>Deploy a timelock (for example OpenZeppelin&apos;s <code>TimelockController</code>) with a minimum delay at least as long as the lock, the team&apos;s multisig as proposer and canceller, and anyone as executor.</li>
        <li>Replace the recovery owner with the timelock: the Safe&apos;s <code>swapOwner(prevOwner, recoveryOwner, timelock)</code>, signed by two owners.</li>
        <li>Check the account&apos;s public page: it should say <em>Fully bound</em>. From then on, anything the team wants to do without Palisec must first be scheduled through the timelock, in public, and waits out the delay.</li>
      </ol>
      <p>Recovery still works: the team can use the timelock to replace a lost agent key, only slowly and in the open.</p>
    </DocArticle>
  );
}

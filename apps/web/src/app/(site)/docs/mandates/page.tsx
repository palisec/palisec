import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Holder mandates",
  description: "Let $PALISEC holders vote on an agent's limits inside an envelope the owner sets. Signed votes, a token snapshot rebuilt from chain, the loosening delay, and vote files anyone can recount.",
  alternates: { canonical: "/docs/mandates" }, openGraph: pageOpenGraph("/docs/mandates"),
};

const CREATE = `POST /api/v1/mandates            (console session, owner or admin)
{
  "slug": "my-agent",
  "name": "My agent's limits",
  "agent_id": "<agent id>",
  "voting_period_seconds": 172800,          // 60 s to 30 days; 24-72 h recommended
  "quorum": "1000000000000000000000",       // $PALISEC base units (18 decimals): 1,000
  "pass_bps": 5000,                         // for must be more than 50% of for + against
  "proposer_min": "1000000000000000000",
  "envelope": {
    "max_transaction_value_wei": "300000000000000",
    "max_hourly_budget_usd_micros": "2000000",
    "min_approval_threshold_usd_micros": "500000",
    "allowed_contracts": [{ "address": "0x…", "selectors": ["0x04e45aaf"] }]
  }
}`;

const TYPES = `domain  { name: "Palisec Mandates", version: "1", chainId: 4663 }

Proposal { string mandate; string title; string change; string nonce }
Vote     { string mandate; string proposalId; uint8 choice; uint256 snapshotBlock }
         // choice: 0 = for, 1 = against, 2 = abstain`;

export default function MandatesDocsPage() {
  return (
    <DocArticle
      title="Holder mandates"
      lede="$PALISEC holders vote on an agent's limits, inside an envelope the owner sets. A passed vote becomes an ordinary policy version, and Palisec's co-signer enforces it."
      maturity="service"
      compat="Robinhood Chain 4663 · $PALISEC"
    >
      <h2 id="how">How it works</h2>
      <ol>
        <li><strong>The owner sets an envelope:</strong> the highest per-transaction value and hourly budget, the lowest human-approval threshold, and the only contracts (and functions) a vote may ever allowlist. No vote can go past it.</li>
        <li><strong>A holder proposes one typed change</strong> and signs it (gasless). The change must fit the envelope. Palisec takes a snapshot of every $PALISEC balance at the latest block.</li>
        <li><strong>Holders vote for, against or abstain</strong>, each signing with their wallet (gasless). Weight is the balance at the snapshot block, so tokens bought after the proposal opens do not count.</li>
        <li><strong>When voting closes</strong>, the count is final. A proposal passes when the votes cast reach the quorum and <em>for</em> is more than the pass share of for + against.</li>
        <li><strong>A tightening applies at once. A loosening waits</strong> out the organization&apos;s loosening delay (60 minutes by default) with a visible countdown, and the owner or an operator can cancel it with a public reason.</li>
      </ol>
      <p>The emergency stop still overrides everything. Votes change limits only; they never sign, approve or send anything.</p>

      <h2 id="changes">What a vote can change</h2>
      <table>
        <thead><tr><th>Change</th><th>Bounded by</th></tr></thead>
        <tbody>
          <tr><td><code>set_max_transaction_value</code></td><td>envelope maximum</td></tr>
          <tr><td><code>set_hourly_budget</code></td><td>envelope maximum</td></tr>
          <tr><td><code>set_max_transaction_usd</code></td><td>envelope <code>max_transaction_usd_micros</code> (optional; without it a vote cannot set the limit). The policy must count token spend (<code>token_spend</code>, schema 1.5): this is its per-transaction limit, tokens included.</td></tr>
          <tr><td><code>set_approval_threshold</code></td><td>envelope minimum</td></tr>
          <tr><td><code>allow_contract</code></td><td>only contracts and functions in the envelope</td></tr>
          <tr><td><code>remove_contract</code>, <code>add_deny</code></td><td>always allowed (they tighten)</td></tr>
        </tbody>
      </table>
      <p>Removing a deny rule is never allowed by a vote. Each signed proposal is single-use.</p>

      <h2 id="snapshot">The snapshot</h2>
      <p>
        Palisec rebuilds the full holder table at the snapshot block by replaying every $PALISEC <code>Transfer</code> log, then
        cross-checks it against <code>balanceOf</code> and <code>totalSupply</code> at that block. If anything differs or cannot
        be read, the proposal is not opened (<code>PS_STATE_001</code>): fail closed.
      </p>

      <h2 id="recount">Recount any vote</h2>
      <p>
        Each proposal has a public vote file with every signature, every weight, the full holder table and the result. Anyone can
        recount it with a public RPC and without trusting Palisec: check each signature against the typed data below, rebuild the
        balances from <code>Transfer</code> logs up to the snapshot block, and apply the rules.
      </p>
      <CodeBlock code={TYPES} title="EIP-712 typed data" />

      <h2 id="api">API</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Who</th></tr></thead>
        <tbody>
          <tr><td><code>POST /v1/mandates</code></td><td>owner or admin</td></tr>
          <tr><td><code>GET /v1/mandates</code>, <code>GET /v1/mandates/&#123;id&#125;</code></td><td>organization members</td></tr>
          <tr><td><code>POST /v1/mandates/&#123;id&#125;/envelope</code></td><td>owner</td></tr>
          <tr><td><code>POST /v1/mandates/&#123;id&#125;/proposals/&#123;pid&#125;/cancel</code></td><td>owner, admin or operator; reason required and shown publicly</td></tr>
          <tr><td><code>GET /v1/public/mandates/&#123;slug&#125;</code></td><td>anyone</td></tr>
          <tr><td><code>POST /v1/public/mandates/&#123;slug&#125;/proposals</code></td><td>a holder, with a signed proposal</td></tr>
          <tr><td><code>POST /v1/public/mandates/&#123;slug&#125;/proposals/&#123;pid&#125;/votes</code></td><td>a holder, with a signed vote</td></tr>
          <tr><td><code>GET /v1/public/mandates/&#123;slug&#125;/proposals/&#123;pid&#125;/vote-file</code></td><td>anyone</td></tr>
        </tbody>
      </table>
      <CodeBlock code={CREATE} title="Create a mandate" />
      <p>
        Webhooks: <code>mandate.proposal_created</code>, <code>mandate.vote_closed</code>, <code>mandate.applied</code> and{" "}
        <code>mandate.cancelled</code>. In the console, the Mandates page shows the envelope, proposals and pending changes.
      </p>

      <h2 id="demo">Live demo</h2>
      <p>
        <Link href="/m/palisec-demo">palisec.tech/m/palisec-demo</Link> is a demo mandate on mainnet with 1-hour votes (real
        mandates should use 24 to 72 hours). It shows the envelope, the active limits, every proposal with its live count and vote
        file, any pending change with its countdown, and the agent&apos;s latest decisions.
      </p>
      <Note kind="note" title="What a mandate does not do">
        It does not move funds, hold tokens or replace the owner. Holders choose limits inside the envelope; the owner chooses the
        envelope and keeps the emergency stop.
      </Note>
    </DocArticle>
  );
}

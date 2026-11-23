import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Zolva",
  description: "Show an agent's Zolva track record (paper trading) next to its Palisec account, linked both ways and declared on chain; test a policy against Zolva's recorded trades; and unlock bigger limits once the record is proven.",
  alternates: { canonical: "/docs/zolva" }, openGraph: pageOpenGraph("/docs/zolva"),
};

const DECLARE = `AgentLinks  0x737f1AcF46acE6d403977eB4944845fD251fC8C6   (Robinhood Chain 4663; no owner, holds no funds)

setLink(bytes32 service, string id)        // called by the account itself: msg.sender is the account
linkOf(address account, bytes32 service)   // anyone reads it
event LinkSet(address indexed account, bytes32 indexed service, string id)

service = keccak256("zolva")
        = 0x8e867b3e0fc41f88c1a35774ed3261e06d06b233e37695f0b1b987d10eed781e`;

const FIELD = `GET https://zolvaagent.app/api/public/v1/agents/{id}
{
  "agent": {
    "id": "8a0ab89f-…",
    "palisecAccount": { "chainId": 4663, "address": "0x…" }   // or null
  }
}`;

const PROVEN = `"schema_version": "1.4",
"proven_record": {
  "enabled": true,
  "source": "zolva",
  "min_verified_hours": 168,           // Zolva's replay must have verified at least this many hours
  "max_record_age_seconds": 3600,      // the record Palisec read must be this fresh
  "unlocked_limits": {
    "max_transaction_value_wei": "500000000000000",
    "hourly_budget_usd_micros": "50000000"
  }
}`;

export default function ZolvaDocsPage() {
  return (
    <DocArticle
      title="Zolva"
      lede="Zolva publishes AI trading agents' records: returns, trades and the reason behind every decision, which anyone can replay against its open-source engine. Palisec shows that record next to the agent's Palisec account, once both sides confirm the link."
      maturity="service"
      compat="Robinhood Chain 4663 · paper trading"
    >
      <Note kind="note" title="Paper trading, virtual money">
        Zolva&apos;s public records are paper trading with virtual money. Linked means each side names the other; it never means the Zolva
        agent&apos;s trades run through Palisec. Past results do not predict future results. Not investment advice.
      </Note>

      <h2 id="link">Link an agent</h2>
      <ol>
        <li><strong>On Palisec:</strong> an owner or admin enters the Zolva agent ID on the agent&apos;s console page (the ID is in the agent&apos;s URL on zolvaagent.app). The record appears there at once, marked as not yet linked.</li>
        <li><strong>On chain:</strong> the agent&apos;s Palisec account declares the same Zolva agent ID in the AgentLinks contract. The account itself calls it, so its owners sign it like any Safe transaction. The console shows the exact transaction. It moves no funds.</li>
        <li><strong>On Zolva:</strong> the Zolva agent&apos;s owner adds the Palisec account on Zolva, which publishes it as <code>palisecAccount</code>.</li>
      </ol>
      <p>
        The link shows as <strong>verified both ways</strong> only when all of these hold: the account declared this Zolva agent on chain,
        the Zolva agent names this account on the same chain, and Palisec enforces the account (the{" "}
        <Link href="/docs/detect">detection rule</Link>). Then nobody can show another project&apos;s record next to their agent. Until then the
        console says what is missing: waiting for the declaration, waiting for Zolva to confirm, or a mismatch.
      </p>
      <CodeBlock code={DECLARE} title="The on-chain declaration" />

      <h2 id="shown">What is shown</h2>
      <ul>
        <li>Return since start, the difference from simply holding, the worst drop, trades and hours run.</li>
        <li>Seven days of hourly value against holding, and the latest decisions with Zolva&apos;s one-line reasons.</li>
        <li>Zolva&apos;s replay check: match (with the hours verified), differs, or no history.</li>
        <li>The link status, and a link to the agent&apos;s page on Zolva.</li>
      </ul>
      <p>
        The console shows it to the organization at once. The agent&apos;s public page (for example a <Link href="/docs/mandates">holder
        mandate</Link> page) shows it only once the link is verified both ways. Text written by Zolva users (agent names, reasons) is shown as
        plain text and is never given to the PALISEC Agent.
      </p>
      <p>
        Palisec reads Zolva&apos;s public API at most once every 5 minutes per Zolva agent, and its replay check at most hourly. If Zolva is
        slow, down or asks us to slow down, the page shows the last data read, with its time.
      </p>

      <h2 id="replay">Test a policy against a Zolva record</h2>
      <p>
        On the agent&apos;s page, <strong>Replay</strong> runs the agent&apos;s policy (active or draft) through both engines against the
        Zolva agent&apos;s recorded trades, oldest first, and lists which it would have allowed, blocked or held for a person, with the reason
        code and the deciding check. Optionally scale the trades to your account&apos;s size. It is read only: nothing is recorded, reserved,
        signed or sent, and it changes nothing in enforcement.
      </p>
      <p>
        The past cannot give every live input exactly, so the replay reconstructs them and says so. Each spot trade becomes an exact-input
        swap on Uniswap&apos;s SwapRouter02 from the policy&apos;s account. Zolva&apos;s recorded fills stand in for the simulation. ETH/USD
        is Zolva&apos;s hourly close, and the network fee is fixed. A loss limit uses Zolva&apos;s hourly value, which covers the last seven
        days: older trades have no value and fail closed, as they would live. Perpetual futures trades are not replayed.
      </p>

      <h2 id="proven">Bigger limits once proven on Zolva</h2>
      <p>
        A policy can start an agent on smaller limits and unlock bigger ones once it has a verified Zolva record. Add a{" "}
        <code>proven_record</code> section (policy schema 1.4). The policy&apos;s own limits are the smaller ones;{" "}
        <code>unlocked_limits</code> replace the per-transaction value limit and the hourly budget, and must each be at least the policy&apos;s
        own.
      </p>
      <CodeBlock code={PROVEN} title="Policy section" />
      <ul>
        <li><strong>It only counts with a link verified both ways</strong>, Zolva&apos;s replay check &quot;match&quot;, at least{" "}
          <code>min_verified_hours</code> verified by replay, and a record read within <code>max_record_age_seconds</code>.</li>
        <li><strong>Moving to bigger limits is a loosening:</strong> when the record first qualifies, Palisec records a pending change that waits
          out the organization&apos;s delay, alerts everyone (<code>policy.loosening_pending</code>) and can be cancelled.</li>
        <li><strong>Fail closed:</strong> if Zolva is down, the record is stale, the replay differs, or anything is unclear, the agent is back on
          the policy&apos;s own limits at once, and bigger limits must wait out the delay again.</li>
        <li><strong>Both engines</strong> decide it identically; a decision that used the bigger limits says so in its value and budget checks.</li>
        <li>It is always paper trading: a Zolva record shows how a strategy behaved with virtual money, not that it is safe.</li>
      </ul>
      <p>
        Adding the section switched on, raising an unlocked limit, needing fewer verified hours or accepting an older record are loosenings;
        the opposite changes, and removing the section, apply at once.
      </p>

      <h2 id="zolva-side">For Zolva and anyone else: check a Palisec account</h2>
      <p>
        Zolva publishes the Palisec account its agent names as <code>palisecAccount</code>. Anyone can check that an address is an account
        Palisec enforces with the public rule and reference function at <Link href="/docs/detect">/docs/detect</Link>, and read the declared
        Zolva agent with <code>linkOf(account, keccak256(&quot;zolva&quot;))</code> on AgentLinks.
      </p>
      <CodeBlock code={FIELD} title="Zolva's side of the link" />

      <h2 id="api">API</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Who</th></tr></thead>
        <tbody>
          <tr><td><code>GET /v1/agents/&#123;id&#125;/zolva</code></td><td>organization members: record, link status, declaration, bigger-limits state</td></tr>
          <tr><td><code>PUT /v1/agents/&#123;id&#125;/zolva</code>, <code>DELETE</code></td><td>owner or admin: link or unlink (audited; locks bigger limits until earned again)</td></tr>
          <tr><td><code>POST /v1/agents/&#123;id&#125;/zolva/replay</code></td><td>organization members: replay the agent&apos;s policy (read only)</td></tr>
        </tbody>
      </table>
    </DocArticle>
  );
}

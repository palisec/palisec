import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";

export const metadata: Metadata = {
  title: "Loss limits",
  description: "Stop an agent from losing more than you allow. Palisec measures the account with Chainlink prices and stops co-signing anything that adds risk once the limit is reached; only the owner can reset it, after the loosening delay.",
  alternates: { canonical: "/docs/loss-limits" }, openGraph: pageOpenGraph("/docs/loss-limits"),
};

const EXAMPLE = `"loss_limit": {
  "enabled": true,
  "max_drawdown_bps": 500,                      // 5.00 %; 0 = not used
  "max_loss_usd_micros": "50000000",            // $50; "0" = not used
  "window_seconds": 86400,                      // 1 hour to 7 days
  "on_breach": "pause_risk",                    // or "review"
  "on_valuation_unavailable": "deny",           // or "review"; never allow
  "stablecoins": ["0x…USDG"],
  "exit_addresses": ["0x…your wallet", "0x…recovery wallet"],
  "max_exit_slippage_bps": 300,
  "max_closed_market_price_age_seconds": 259200,
  "reset_epoch": 0
}`;

export default function LossLimitsDocsPage() {
  return (
    <DocArticle
      title="Loss limits"
      lede="A loss limit stops an agent from losing more than you allow, and the agent cannot talk its way past it. The limit is enforced by Palisec's co-signature, not by the agent's prompt: the agent's key cannot move funds alone, so once the limit is reached, Palisec stops co-signing anything that adds risk."
      maturity="service"
      compat="Policy schema 1.3 · Robinhood Chain 4663"
    >
      <h2 id="setting">Setting one</h2>
      <p>Add a <code>loss_limit</code> section to the policy (schema 1.3). It is off unless you add it.</p>
      <table>
        <thead><tr><th>Field</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>max_drawdown_bps</code></td><td>Largest drop from the window&apos;s peak, in basis points (500 = 5%). 0 = not used.</td></tr>
          <tr><td><code>max_loss_usd_micros</code></td><td>Largest loss from the window&apos;s peak, in USD micros (&quot;50000000&quot; = $50). &quot;0&quot; = not used. Set at least one of the two.</td></tr>
          <tr><td><code>window_seconds</code></td><td>The rolling window, 1 hour to 7 days.</td></tr>
          <tr><td><code>on_breach</code></td><td><code>pause_risk</code>: deny everything that adds risk. <code>review</code>: hold it for a person instead.</td></tr>
          <tr><td><code>on_valuation_unavailable</code></td><td>No reliable account value: <code>deny</code> or <code>review</code>. Never allowed.</td></tr>
          <tr><td><code>stablecoins</code></td><td>What a paused account may still swap into.</td></tr>
          <tr><td><code>exit_addresses</code></td><td>Your own and your recovery wallets. Transfers here are withdrawals, not losses, and stay allowed while paused.</td></tr>
          <tr><td><code>max_exit_slippage_bps</code></td><td>While paused, a swap into a stablecoin may lose at most this much.</td></tr>
          <tr><td><code>max_closed_market_price_age_seconds</code></td><td>How old a stock-token price may be while US markets are closed (for example, 259200 = 72 hours covers a weekend).</td></tr>
          <tr><td><code>reset_epoch</code></td><td>Raised by one to reset a breach (see below).</td></tr>
        </tbody>
      </table>
      <CodeBlock code={EXAMPLE} title="Policy section" />

      <h2 id="measured">How the loss is measured</h2>
      <ul>
        <li><strong>Value:</strong> ETH plus the priced tokens the account holds, at Chainlink prices on Robinhood Chain (ETH, WETH, USDG and the listed stock tokens). Tokens without a Chainlink price count as $0. So buying one counts the whole spend as a loss, and no made-up price can hide a loss.</li>
        <li><strong>No pool prices:</strong> a trading pool&apos;s price never sets the value. A manipulated pool can only change how many tokens a trade returns, and Palisec measures that by simulating the exact trade, so a bad fill shows up as a loss.</li>
        <li><strong>Deposits and withdrawals don&apos;t count:</strong> money sent into the account raises the starting point, money sent back to an exit address lowers it, and only trading results count.</li>
        <li><strong>Peak in the window:</strong> the loss is the drop from the highest value in the window, with deposits and withdrawals taken out.</li>
        <li><strong>Before every decision:</strong> Palisec measures the account and checks the operation&apos;s simulated result. The operation that would cross the limit is itself denied, and nothing reaches the chain.</li>
        <li><strong>Losses, not trade size:</strong> a large trade that loses nothing passes the loss limit. To cap the size of token trades and the tokens spent per hour, add <Link href="/docs/policies#token-spend">token spend limits</Link> (schema 1.5): the per-transaction limit, the hourly budget and the approval threshold then count tokens at the same Chainlink prices.</li>
      </ul>

      <h2 id="reached">When the limit is reached</h2>
      <ul>
        <li>New operations that add risk are denied with <code>PS_LOSS_002</code> (USD limit) or <code>PS_LOSS_001</code> (percentage limit), or held for a person if <code>on_breach</code> is <code>review</code>.</li>
        <li>Still allowed: swaps into the policy&apos;s stablecoins within the exit slippage, transfers to the exit addresses, and bounded token approvals to allowlisted contracts.</li>
        <li>If a price is stale, paused for a corporate action, or USDG is more than 2% from $1, the value is unavailable. Operations that add risk then get <code>PS_LOSS_003</code> and are never allowed.</li>
        <li>The webhook <code>loss_limit.triggered</code> fires, and the console shows a banner on the agent&apos;s page.</li>
      </ul>

      <h2 id="reset">Resetting</h2>
      <ul>
        <li>Only the organization&apos;s owner can reset. The reset is a new policy version with <code>reset_epoch</code> raised by one.</li>
        <li>Because it loosens the rules, it waits for your organization&apos;s delay, alerts everyone (<code>loss_limit.reset_pending</code>), and can be cancelled until then.</li>
        <li>When it applies, the window starts again from the account&apos;s value at that moment (<code>loss_limit.reset</code>).</li>
        <li>Lowering a limit or lengthening the window applies at once. Raising a limit, shortening the window, adding an exit address or a stablecoin, or turning the rule off waits for the delay.</li>
      </ul>

      <h2 id="api">API</h2>
      <table>
        <thead><tr><th>Endpoint</th><th>Who</th></tr></thead>
        <tbody>
          <tr><td><code>GET /v1/agents/&#123;id&#125;/loss-limit</code></td><td>organization members: value, window peak, loss and whether the agent is paused</td></tr>
          <tr><td><code>POST /v1/agents/&#123;id&#125;/loss-limit/reset</code></td><td>owner; a delayed loosening</td></tr>
        </tbody>
      </table>

      <h2 id="chain">On chain</h2>
      <ul>
        <li>The rule is part of the policy, so its hash is published through the <Link href="/docs/standard">Policy-Enforced Agent Accounts</Link> registry with every change (<code>PolicyPending</code>, <code>PolicyActivated</code>).</li>
        <li>Every recorded decision comes with a signed receipt. A loss-limit denial carries the reason <code>OTHER</code> and the detail code <code>palisec:PS_LOSS_00x</code>.</li>
      </ul>
    </DocArticle>
  );
}

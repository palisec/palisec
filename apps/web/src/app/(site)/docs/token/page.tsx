import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { DocArticle } from "@/components/doc";
import { BurnCounter } from "@/components/burn-counter";
import { BILLING, TOKEN, usdE6 } from "@/lib/billing-config";

export const metadata: Metadata = {
  title: "Token",
  description: "What $PALISEC does in Palisec: Pro limits by holding it, credits payable in it with a discount, and every token spent burned on chain.",
  alternates: { canonical: "/docs/token" }, openGraph: pageOpenGraph("/docs/token"),
};

const proTokens = Number(BILLING.proHoldingTokens / 10n ** 18n).toLocaleString("en-US");

export default function TokenDocs() {
  return (
    <DocArticle
      title="$PALISEC in the product"
      lede="Security is never paid for in the token and never needs it. The token unlocks higher limits by holding it, and can pay for decision credits, which burns it."
      maturity="service"
      compat={`ERC-20 · ${TOKEN.palisec} · Robinhood Chain mainnet 4663`}
    >
      <h2 id="credits">Decision credits</h2>
      <ul>
        <li>{BILLING.freeDecisionsPerMonth.toLocaleString("en-US")} mainnet decisions per organization per month are included. Testnet and dry runs (<code>/v1/authorizations/evaluate</code>) are free and never metered.</li>
        <li>Past the allowance, each mainnet decision uses one prepaid credit: {usdE6(BILLING.priceUsdE6PerThousand)} per 1,000, bought in the console (Billing) with USDG or ETH. ETH is priced with Chainlink ETH/USD.</li>
        <li>With no allowance and no credits left, a mainnet request is refused with <code>402 PS_CREDIT_001</code> before it is evaluated. Nothing is authorized, so a PALISEC smart account cannot move anything. Requests are never allowed unchecked. The API sends <code>X-Palisec-Usage</code> on every metered decision and <code>X-Palisec-Usage-Warning</code> at 80% and 95% of the allowance.</li>
      </ul>

      <h2 id="pay-in-palisec">Paying in $PALISEC</h2>
      <p>
        Credits will also be payable in $PALISEC at {BILLING.palisecDiscountBps / 100}% off. The tokens are burned in the same transaction (<code>burnFrom</code>, which lowers the total supply). The price comes from a {BILLING.twapWindowSeconds / 60}-minute time-weighted average of the token&apos;s pool, and a purchase is refused when the pool is under {usdE6(BILLING.minPoolUsdE6)}, the spot price is more than {BILLING.maxDeviationBps / 100}% from the average, or it exceeds {usdE6(BILLING.maxPalisecUsdE6PerPurchase)} per purchase or {usdE6(BILLING.maxPalisecUsdE6PerAccountPerDay)} per organization per day.
        This path is switched off until such a price exists: today the token trades only on its launch curve.
      </p>

      <h2 id="pro">Pro by holding</h2>
      <p>
        When an owner wallet of the organization holds at least {proTokens} $PALISEC, the organization gets Pro limits: 5× agents and policies, a year of audit history, 5× API rate limit and 10× PALISEC Agent requests. The balance is read from the chain at sign-in and every few minutes while the console is used; nothing is locked or sent. Below the amount, the standard limits apply again and nothing is deleted.
      </p>

      <h2 id="burns">Burned so far</h2>
      <BurnCounter />

      <h2 id="what-it-is-not">What the token is not</h2>
      <ul>
        <li>No revenue share, buybacks, staking yield or any return. USDG and ETH payments are ordinary revenue.</li>
        <li>Not needed for security: every organization gets every check, with or without the token.</li>
      </ul>
    </DocArticle>
  );
}

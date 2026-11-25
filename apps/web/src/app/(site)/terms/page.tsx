import type { Metadata } from "next";
import { LinePageHeader, LineSection } from "@/components/line/compat";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { Container } from "@/components/ui";
import { CONTACT_LABEL, CONTACT_URL, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Palisec: the console, the authorization API, smart-account co-signing and the website.",
  alternates: { canonical: "/terms" }, openGraph: pageOpenGraph("/terms"),
};

export default function TermsPage() {
  return (
    <>
      <LinePageHeader eyebrow="Legal" title="Terms of Service" lede={`Effective ${TERMS_VERSION}. These terms govern your use of Palisec. By signing in you accept them.`} />
      <Container className="py-16 sm:py-20">
        <article className="prose-ps max-w-[47.5rem]">
          <h2 id="service">1. The service</h2>
          <p>
            Palisec (&ldquo;Palisec&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides an authorization service for autonomous on-chain agents: a
            console to manage organizations, agents, API keys, policies and approvals; an API that evaluates proposed transactions against those
            policies and records each decision; and, for agents that use a Palisec smart account, co-signing and submission of the operations it
            authorized (together, the &ldquo;Service&rdquo;), with this website and its documentation.
          </p>
          <p>
            The Service supports <strong>Robinhood Chain mainnet</strong> (chain 4663), where transactions move
            real funds, and Robinhood Chain Testnet (chain 46630), where they do not. The <Link href="/status">status page</Link> and{" "}
            <Link href="/changelog">changelog</Link> state what is available.
          </p>
          <p>
            <strong>We never hold your funds or your private keys.</strong> Funds stay in smart accounts that you and your organization own. A
            Palisec smart account needs two of its three owners to sign: your agent&apos;s key, Palisec&apos;s co-signer, and a recovery owner you
            control. Palisec&apos;s co-signer cannot move funds alone, and your recovery owner together with your agent&apos;s key can always move
            funds without Palisec. An agent that sends from a plain key, without a Palisec smart account, is not enforced on chain.
          </p>

          <h2 id="accounts">2. Accounts and organizations</h2>
          <ul>
            <li>You sign in by proving control of a wallet address with a signed message (Sign-In with Ethereum). The first sign-in creates an organization with you as its owner.</li>
            <li>You are responsible for everything done with your wallet, your sessions and your organization&apos;s API keys, and for who you add as a member and with which role.</li>
            <li>API keys are shown once. Mainnet keys start with <code>ps_live_</code> and testnet keys with <code>ps_test_</code>. Keep them secret, store them only server-side, and revoke a key immediately if you suspect it is exposed.</li>
            <li>You must be at least 18 years old and able to enter into a binding agreement, and you must not be barred from using the Service under applicable law, including sanctions laws.</li>
          </ul>

          <h2 id="responsibility">3. Your responsibility for agents and transactions</h2>
          <p>
            You decide which policies to activate, which accounts and keys your agents use, and which transactions they send. An ALLOW decision or
            a Palisec co-signature means a request satisfied your active policy at that moment; it is not advice, a recommendation, or a guarantee
            that a transaction is safe, profitable or will succeed. A DENY or a held request is not a guarantee that harm was prevented. You are
            solely responsible for your agents, keys, recovery owners, smart accounts, the transactions they send, the funds they hold, and
            compliance with the laws that apply to you, including tax and reporting obligations.
          </p>
          <p>
            Test your policies on testnet before using them on mainnet, start mainnet use with small amounts, and keep your recovery owner under
            your organization&apos;s control.
          </p>

          <h2 id="risk">4. Blockchain and real-funds risk</h2>
          <p>Using the Service on mainnet involves risks that we do not control and cannot reverse, including that:</p>
          <ul>
            <li>blockchain transactions are final: a transaction that executed cannot be undone by us or anyone else;</li>
            <li>smart contracts we rely on (including Safe, the Safe 4337 module and the ERC-4337 EntryPoint) and the tokens and contracts your agents interact with may contain defects or be exploited;</li>
            <li>Robinhood Chain, RPC providers, bundlers and price sources are operated by third parties and may be delayed, unavailable, congested or wrong; gas prices can change;</li>
            <li>keys can be lost or stolen, and a stolen agent key together with a compromise of Palisec&apos;s co-signer could produce transactions outside your policy;</li>
            <li>when a required input is missing or a check cannot complete, the Service refuses (it fails closed), which can delay or prevent a transaction you wanted.</li>
          </ul>
          <p>You accept these risks when you use the Service with real funds.</p>

          <h2 id="token">5. The $PALISEC token</h2>
          <p>
            5.1 <strong>What it is.</strong> $PALISEC is an ERC-20 token on Robinhood Chain (contract <code>0x1b4d04c8a67bf98bdf791ef928482bcb225d71ab</code>). It was
            launched on a third-party launchpad. Palisec does not control its supply, price or trading.
          </p>
          <p>5.2 <strong>What it does in the Service.</strong></p>
          <p>
            (a) <strong>Pro limits by holding.</strong> If a wallet that owns an organization holds at least the amount shown on the{" "}
            <Link href="/docs/token">Token page</Link>, that organization gets the higher Pro limits described there. Palisec only reads the wallet&apos;s balance;
            nothing is locked, transferred or held by Palisec. Limits return to standard when the balance is below the amount.
          </p>
          <p>
            (b) <strong>Paying for decision credits</strong> (when this option is enabled on the Token page). Credits can be bought with $PALISEC at the discount
            shown. Tokens used to buy credits are burned (permanently destroyed) in the same transaction and are not received by Palisec.
          </p>
          <p>
            (c) Credits can also be bought with USDG or ETH. Credits are a prepaid right to use the Service, are not refundable except where required by law,
            cannot be transferred and have no value outside the Service.
          </p>
          <p>
            5.3 <strong>What it is not.</strong> Holding or using $PALISEC gives no ownership, share, dividend, revenue, profit, yield, interest, vote or other right
            in Palisec or its business, and no right to any payment. Palisec does not buy back tokens and makes no promise about the token&apos;s price, liquidity or
            future use. Core security features of the Service never require the token.
          </p>
          <p>
            5.4 <strong>Risks.</strong> Token prices can move sharply or fall to zero, liquidity may be very limited, and blockchain transactions are final. You are
            responsible for your wallet, keys and taxes, and for following the laws that apply to you.
          </p>
          <p>
            5.5 <strong>Changes.</strong> Palisec may change or end the token features in this section (for example the discount, the Pro amount or the option to pay
            in $PALISEC) by updating the Token page; changes do not affect credits already bought.
          </p>
          <p>
            5.6 Only the token address above and the credits contract shown in the console are ours. We never message you a different address or ask you to send
            funds anywhere else.
          </p>

          <h2 id="acceptable-use">6. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>access or attempt to access another organization&apos;s data, or bypass authentication, roles or rate limits;</li>
            <li>disrupt, overload or degrade the Service, or probe it except as permitted by our <Link href="/security#disclosure">disclosure policy</Link>;</li>
            <li>use the Service for unlawful activity, including fraud, market manipulation, money laundering or sanctions evasion;</li>
            <li>resell or provide the Service to third parties as your own hosted service without our written permission.</li>
          </ul>
          <p>
            We may rate-limit, suspend or close access that breaches these terms or threatens the Service or other users, and we may stop
            co-signing for an organization (an emergency stop) to protect it or others. Funds in your smart accounts remain movable by your
            recovery owner and your agent&apos;s key.
          </p>

          <h2 id="data">7. Your data</h2>
          <p>
            You keep all rights to the data you put into the Service (policies, agent and organization details, and the operations your agents
            submit). You grant us the rights needed to host, process and display it to operate the Service for you. The audit trail is append-only
            by design and cannot be edited. Transactions executed on a blockchain are public and permanent. How we handle personal data is
            described in the <Link href="/privacy">Privacy Policy</Link>.
          </p>

          <h2 id="fees">8. Fees</h2>
          <p>
            Each organization gets a monthly allowance of free mainnet decisions; testnet and dry runs are free. Beyond the allowance, mainnet decisions use
            prepaid credits at the price shown on the <Link href="/pricing">pricing page</Link> (see section 5.2). Network gas fees are paid by your smart
            accounts and wallets, not by us. We will publish any price change before it applies; credits already bought keep their value.
          </p>

          <h2 id="availability">9. Availability and changes</h2>
          <p>
            We aim to keep the Service available but do not promise uninterrupted operation, and we do not offer a service-level agreement unless one
            is agreed in writing. When the Service cannot reach its database or a required input, it refuses to authorize (it fails closed) rather than
            allowing by default. We may change, suspend or discontinue features, including support for a network, and will announce material
            changes in the changelog.
          </p>

          <h2 id="warranty">10. No warranty</h2>
          <p>
            The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>, without warranties of any kind, express or
            implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement, to the fullest extent permitted by law.
          </p>

          <h2 id="liability">11. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, we are not liable for any indirect, incidental, special, consequential or punitive damages, or
            for any loss of funds, digital assets, profits, data or goodwill, arising from your use of or inability to use the Service, including
            losses from transactions your agents send whether or not the Service authorized or co-signed them, and losses from delayed or refused
            transactions. Our total liability for any claim relating to the Service is limited to the greater of the fees you paid us in the twelve
            months before the claim and one hundred US dollars. Nothing in these terms limits liability that cannot be limited by law.
          </p>

          <h2 id="indemnity">12. Indemnity</h2>
          <p>
            You will indemnify us against third-party claims arising from your agents, your transactions, your data, or your breach of these terms,
            except to the extent caused by our own breach.
          </p>

          <h2 id="termination">13. Ending use</h2>
          <p>
            You may stop using the Service at any time and ask us to delete your organization by messaging{" "}
            <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{CONTACT_LABEL}</a>. Your smart accounts are yours and keep working without us through your recovery
            owner. We may suspend or end your access if you breach these terms or if we discontinue the Service, with notice where reasonably
            possible. Sections 3, 4, 5, 7, 10, 11 and 12 survive termination.
          </p>

          <h2 id="changes">14. Changes to these terms</h2>
          <p>
            We may update these terms. The effective date at the top changes when we do, and material changes are announced in the changelog. Signing
            in after a change means you accept the updated terms.
          </p>

          <h2 id="contact">15. Contact</h2>
          <p>
            Questions about these terms: <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{CONTACT_LABEL}</a>. Security reports:{" "}
            <Link href="/security#disclosure">disclosure policy</Link>.
          </p>
        </article>
      </Container>
    </>
  );
}

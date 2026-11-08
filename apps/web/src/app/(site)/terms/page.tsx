import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui";
import { CONTACT_EMAIL, TERMS_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using Palisec: the console, the authorization API and the website.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms of Service" lede={`Effective ${TERMS_VERSION}. These terms govern your use of Palisec. By signing in you accept them.`} />
      <Container className="py-16 sm:py-20">
        <article className="prose-ps max-w-[760px]">
          <h2 id="service">1. The service</h2>
          <p>
            Palisec (&ldquo;Palisec&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) provides an authorization service for autonomous on-chain agents: a
            console to manage organizations, agents, API keys, policies and approvals, and an API that evaluates proposed transactions against those
            policies and records each decision (the &ldquo;Service&rdquo;), together with this website and its documentation.
          </p>
          <p>
            The Service is a <strong>pre-release</strong> and currently supports <strong>Robinhood Chain Testnet only</strong>. It records and enforces
            authorization decisions for agents that call it. It does not hold funds, does not hold or use your private keys, and does not sign or
            broadcast transactions. Until an on-chain enforcement module is available, a key that does not consult Palisec can still transact. The{" "}
            <Link href="/status">status page</Link> and <Link href="/changelog">changelog</Link> state what is available.
          </p>

          <h2 id="accounts">2. Accounts and organizations</h2>
          <ul>
            <li>You sign in by proving control of a wallet address with a signed message (Sign-In with Ethereum). The first sign-in creates an organization with you as its owner.</li>
            <li>You are responsible for everything done with your wallet, your sessions and your organization&apos;s API keys, and for who you add as a member and with which role.</li>
            <li>API keys are shown once. Keep them secret, store them only server-side, and revoke a key immediately if you suspect it is exposed.</li>
            <li>You must be at least 18 years old and able to enter into a binding agreement, and you must not be barred from using the Service under applicable law, including sanctions laws.</li>
          </ul>

          <h2 id="responsibility">3. Your responsibility for agents and transactions</h2>
          <p>
            You decide which policies to activate and which transactions your agents send. An ALLOW decision means a request satisfied your active
            policy at that moment; it is not advice, a recommendation, or a guarantee that a transaction is safe, profitable or will succeed. A DENY
            or a held request is not a guarantee that harm was prevented. You are solely responsible for your agents, keys, smart accounts, the
            transactions they send, and compliance with the laws that apply to you. <strong>Do not use the Service with real funds</strong> while it
            supports testnet only.
          </p>

          <h2 id="acceptable-use">4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>access or attempt to access another organization&apos;s data, or bypass authentication, roles or rate limits;</li>
            <li>disrupt, overload or degrade the Service, or probe it except as permitted by our <Link href="/security#disclosure">disclosure policy</Link>;</li>
            <li>use the Service for unlawful activity, including fraud, money laundering or sanctions evasion;</li>
            <li>resell or provide the Service to third parties as your own hosted service without our written permission.</li>
          </ul>
          <p>We may rate-limit, suspend or close access that breaches these terms or threatens the Service or other users.</p>

          <h2 id="data">5. Your data</h2>
          <p>
            You keep all rights to the data you put into the Service (policies, agent and organization details, and the operations your agents
            submit). You grant us the rights needed to host, process and display it to operate the Service for you. The audit trail is append-only
            by design and cannot be edited. How we handle personal data is described in the <Link href="/privacy">Privacy Policy</Link>.
          </p>

          <h2 id="fees">6. Fees</h2>
          <p>
            The Service is currently free. If we introduce paid plans, we will publish the prices and give you notice before any charge applies;
            paid use will require you to accept the plan terms at that time.
          </p>

          <h2 id="availability">7. Availability and changes</h2>
          <p>
            We aim to keep the Service available but do not promise uninterrupted operation, and we do not offer a service-level agreement during
            pre-release. When the Service cannot reach its database or a required input, it refuses to authorize (it fails closed) rather than
            allowing by default. We may change, suspend or discontinue features, and will announce material changes in the changelog.
          </p>

          <h2 id="warranty">8. No warranty</h2>
          <p>
            The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as available&rdquo;</strong>, without warranties of any kind, express or
            implied, including merchantability, fitness for a particular purpose, accuracy and non-infringement, to the fullest extent permitted by law.
          </p>

          <h2 id="liability">9. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, we are not liable for any indirect, incidental, special, consequential or punitive damages, or
            for any loss of funds, digital assets, profits, data or goodwill, arising from your use of or inability to use the Service, including
            losses from transactions your agents send whether or not the Service authorized them. Our total liability for any claim relating to the
            Service is limited to the greater of the fees you paid us in the twelve months before the claim and one hundred US dollars. Nothing in
            these terms limits liability that cannot be limited by law.
          </p>

          <h2 id="indemnity">10. Indemnity</h2>
          <p>
            You will indemnify us against third-party claims arising from your agents, your transactions, your data, or your breach of these terms,
            except to the extent caused by our own breach.
          </p>

          <h2 id="termination">11. Ending use</h2>
          <p>
            You may stop using the Service at any time and ask us to delete your organization by writing to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We may suspend or end your access if you breach these terms or if we discontinue
            the Service, with notice where reasonably possible. Sections 3, 5, 8, 9 and 10 survive termination.
          </p>

          <h2 id="changes">12. Changes to these terms</h2>
          <p>
            We may update these terms. The effective date at the top changes when we do, and material changes are announced in the changelog. Signing
            in after a change means you accept the updated terms.
          </p>

          <h2 id="contact">13. Contact</h2>
          <p>
            Questions about these terms: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Security reports:{" "}
            <Link href="/security#disclosure">disclosure policy</Link>.
          </p>
        </article>
      </Container>
    </>
  );
}

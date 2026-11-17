import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageHeader } from "@/components/ui";
import { CONTACT_LABEL, CONTACT_URL, PRIVACY_VERSION } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Palisec collects, why, where it is stored, how long it is kept, and your rights.",
  alternates: { canonical: "/privacy" },
};

const DATA: [string, string, string][] = [
  ["Wallet address", "To sign you in and identify you as a member of your organization.", "Until your organization is deleted."],
  ["Sign-in records", "Challenge, time and domain of each sign-in, and the terms version you accepted, kept in the audit trail.", "For the life of the organization (the audit trail is append-only)."],
  ["Session", "A random token in a cookie; we store only its SHA-256 hash.", "12 hours, or until you sign out."],
  ["Organization content", "Organization name, members and roles, agents, smart-account addresses, policies, API key labels, operations and approvals your agents create.", "Until your organization is deleted."],
  ["API keys", "Only a SHA-256 hash and a short non-secret prefix; the key itself is shown to you once and never stored.", "Until the agent or organization is deleted."],
  ["Network address (IP)", "Held briefly in server memory to rate-limit sign-in and API use. Not written to our database.", "Minutes."],
  ["Hosting logs", "Our host records request metadata (IP address, time, path, user agent) for operations and security.", "Per the host's retention, typically days."],
];

const PROCESSORS: [string, string][] = [
  ["Vercel Inc. (USA)", "Hosting, request logs, TLS"],
  ["Neon (USA, us-east)", "Postgres database"],
  ["GitHub Inc. (USA)", "Encrypted database backups (14 days) and source code"],
  ["GoDaddy (USA)", "Domain name system and email forwarding"],
  ["Robinhood Chain RPC", "Gas price and contract-code lookups for the addresses in a request; no personal data is sent"],
  ["Coinbase and Kraken", "Public ETH/USD price; no personal data is sent"],
];

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy Policy" lede={`Effective ${PRIVACY_VERSION}. Palisec collects as little as it can to authorize transactions for your agents, and nothing for advertising.`} />
      <Container className="py-16 sm:py-20">
        <article className="prose-ps max-w-[820px]">
          <h2 id="summary">In short</h2>
          <ul>
            <li>No analytics, no advertising, no third-party trackers, and no cookies besides the one that keeps you signed in.</li>
            <li>We do not ask for your name or email to use the console; a wallet address is enough.</li>
            <li>Data your agents send is used only to evaluate and record their authorization decisions.</li>
            <li>We never receive or store your private keys or recovery phrases. Never send them to anyone, including us.</li>
          </ul>

          <h2 id="collect">What we collect and why</h2>
          <div className="not-prose overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="text-dim">
                  {["Data", "Purpose", "Kept"].map((h) => (
                    <th key={h} className="label border-b border-line-strong px-3 py-2 !text-[10px]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DATA.map(([d, p, k]) => (
                  <tr key={d} className="border-b border-line align-top">
                    <td className="px-3 py-3 text-mist">{d}</td>
                    <td className="px-3 py-3 text-muted">{p}</td>
                    <td className="px-3 py-3 text-muted">{k}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-6">
            Wallet addresses and transactions are public on the blockchain by nature. The policies, operations and audit records in your
            organization are not public: only members of your organization can see them, according to their role.
          </p>

          <h2 id="basis">Legal basis</h2>
          <p>
            We process this data to provide the Service you signed up for (performance of a contract), and to keep it secure and prevent abuse (our
            legitimate interest). We do not sell personal data or use it to profile you.
          </p>

          <h2 id="cookies">Cookies and browser storage</h2>
          <p>
            One strictly necessary cookie, <code>__Host-ps_session</code>, keeps you signed in. It is HttpOnly, secure and same-site, so scripts and
            other sites cannot read it. The console also remembers which organization you last selected in your browser&apos;s local storage. Neither
            is used for tracking, so no consent banner is needed.
          </p>

          <h2 id="processors">Where data goes</h2>
          <p>We use these providers to run the Service. Data is stored in the United States.</p>
          <ul>
            {PROCESSORS.map(([n, p]) => (
              <li key={n}><strong>{n}</strong>: {p}.</li>
            ))}
          </ul>

          <h2 id="security">Security</h2>
          <p>
            Connections are encrypted with TLS. Sessions and API keys are stored only as hashes. Roles are enforced on the server for every request,
            and the audit trail cannot be altered. Backups are encrypted. See the <Link href="/security">security model</Link> for details.
          </p>

          <h2 id="rights">Your rights</h2>
          <p>
            You can ask for a copy of your personal data, ask us to correct it, or ask us to delete your organization and the personal data in it by
            messaging <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{CONTACT_LABEL}</a> and proving control of your wallet when we ask.
            We answer within 30 days. Because the audit trail is append-only, deletion removes your organization as a whole rather than individual
            records within it. You may also complain to your local data-protection authority.
          </p>

          <h2 id="children">Children</h2>
          <p>The Service is not intended for anyone under 18, and we do not knowingly collect their data.</p>

          <h2 id="changes">Changes</h2>
          <p>
            We will update the effective date when this policy changes and announce material changes in the <Link href="/changelog">changelog</Link>.
          </p>

          <h2 id="contact">Contact</h2>
          <p>
            Privacy questions and requests: <a href={CONTACT_URL} target="_blank" rel="noopener noreferrer">{CONTACT_LABEL}</a>.
          </p>
        </article>
      </Container>
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { DocArticle } from "@/components/doc";
import { MaturityBadge } from "@/components/ui";
import { CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Guides and reference for the Palisec policy schema, authorization protocol, SDKs and security model.",
  alternates: { canonical: "/docs" },
};

const GUIDES = [
  { href: "/docs/quickstart", title: "Quickstart", body: "Install, configure the network, create a constrained test account, submit an operation and inspect the decision." },
  { href: "/docs/policies", title: "Policy schema", body: "Canonical JSON schema, every rule, precedence, units, limits and validation errors." },
  { href: "/docs/errors", title: "Errors and operations", body: "Reason codes, retry semantics, operation states, reservations and recovery." },
  { href: "/docs/account-abstraction", title: "Account abstraction", body: "ERC-4337 validation, authorization binding, replay protection and human approvals." },
  { href: "/architecture", title: "Architecture", body: "Control, enforcement, chain and observability planes, and how they fail." },
  { href: "/security", title: "Security model", body: "Threats, trust boundaries, key lifecycle, limitations and release gates." },
];

export default function DocsIndex() {
  return (
    <DocArticle
      title="Documentation"
      lede="Palisec is pre-release. Each guide marks what you can run today, what is specified but not deployed, and what is planned. Snippets that cannot run yet are labelled as pseudocode."
      maturity="local"
      compat="Schema 1.0 · docs revision 2026-11"
    >
      <div className="not-prose grid gap-px border border-line bg-line sm:grid-cols-2">
        {GUIDES.map((g) => (
          <Link key={g.href} href={g.href} className="group bg-ink p-5 no-underline hover:bg-surface">
            <p className="text-[15px] font-medium text-fg">{g.title} <span className="font-mono text-xs text-dim group-hover:text-fg">→</span></p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{g.body}</p>
          </Link>
        ))}
      </div>

      <h2>What exists today</h2>
      <table>
        <thead>
          <tr><th>Component</th><th>Status</th></tr>
        </thead>
        <tbody>
          {CAPABILITIES.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
                <br />
                <span className="text-sm text-muted">{c.note}</span>
              </td>
              <td className="whitespace-nowrap"><MaturityBadge maturity={c.maturity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DocArticle>
  );
}

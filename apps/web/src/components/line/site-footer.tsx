import Link from "next/link";
import { BrandMark } from "../brand-mark";
import { X_URL } from "../site-chrome";
import { Split } from "./split";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/accounts", label: "Accounts" },
      { href: "/limits", label: "Limits" },
      { href: "/mandates", label: "Mandates" },
      { href: "/agent", label: "Palisec Agent" },
      { href: "/architecture", label: "Architecture" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Proof and standard",
    links: [
      { href: "/proof", label: "Proof" },
      { href: "/standard", label: "ERC-8511" },
      { href: "/status", label: "Status" },
      { href: "/attestation", label: "Attestation" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/developers", label: "Start building" },
      { href: "/docs", label: "Documentation" },
      { href: "/docs/sdk/typescript", label: "TypeScript SDK" },
      { href: "/docs/sdk/python", label: "Python SDK" },
      { href: "/docs/mcp", label: "MCP server" },
      { href: "/docs/errors", label: "Reason codes" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/ecosystem", label: "Ecosystem" },
      { href: "/token", label: "Token" },
      { href: "/changelog", label: "Changelog" },
      { href: X_URL, label: "X" },
      { href: "/terms", label: "Terms" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
];

export function LineFooter() {
  return (
    <footer className="relative">
      <Split
        left={
          <div className="space-y-5">
            <Link href="/" aria-label="Palisec home" className="inline-flex items-center gap-3">
              <BrandMark size={30} />
              <span className="font-brand text-[22px] font-medium tracking-[-0.02em] text-mist">Palisec</span>
            </Link>
            <p className="max-w-[34ch] text-[15px] leading-relaxed text-silver">Agents decide. Palisec enforces the limits, on chain.</p>
            <p className="t-label">Robinhood Chain 4663</p>
          </div>
        }
        right={
          <div className="grid grid-cols-2 gap-x-8 gap-y-10 md:grid-cols-4">
            {COLUMNS.map((col) => (
              <nav key={col.title} aria-label={col.title}>
                <p className="t-label mb-5">{col.title}</p>
                <ul className="space-y-3">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {l.href.startsWith("http") ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-[15px] text-foam transition-colors hover:text-aqua">{l.label}</a>
                      ) : (
                        <Link href={l.href} className="text-[15px] text-foam transition-colors hover:text-aqua">{l.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        }
      />
      <div className="split border-t border-line py-6">
        <p className="t-label">No third-party tracking</p>
        <p className="t-label">Times in UTC</p>
      </div>
    </footer>
  );
}

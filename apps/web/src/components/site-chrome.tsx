import Link from "next/link";
import { CubeGlyph } from "./cube";
import { NavShell } from "./nav-shell";
import { ButtonLink, Container } from "./ui";

export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Palisec home">
      <span className="transition-transform duration-500 group-hover:rotate-[60deg]">
        <CubeGlyph size={size === "lg" ? 22 : 18} />
      </span>
      <span className="font-brand text-[19px] font-semibold tracking-[0.02em] text-bone">Palisec<span className="text-citrine">Wall</span></span>
    </Link>
  );
}

export const NAV = [
  { href: "/product", label: "Product" },
  { href: "/architecture", label: "Architecture" },
  { href: "/docs", label: "Docs" },
  { href: "/security", label: "Security" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 px-3 pt-3">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-[4px] focus:bg-citrine focus:px-3 focus:py-1 focus:text-carbon">
        Skip to content
      </a>
      <NavShell>
        <Wordmark />
        <nav aria-label="Primary" className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="group relative font-utility text-[13px] uppercase tracking-[0.1em] text-bone">
              {n.label}
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-citrine transition-transform duration-300 group-hover:scale-x-100" />
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex">
            <ButtonLink href="/login">Open Console</ButtonLink>
          </span>
          <details className="group relative lg:hidden">
            <summary className="flex h-10 cursor-pointer list-none items-center rounded-[4px] border border-bone/70 px-3 text-[12px] font-medium uppercase tracking-[0.032em] text-bone [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Menu</span>
              <span className="hidden group-open:inline">Close</span>
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 top-12 w-60 animate-[fade-up_.25s_ease-out] overflow-hidden rounded-[8px] border border-graphite bg-carbon">
              {[...NAV, { href: "/login", label: "Open Console" }].map((n) => (
                <Link key={n.href} href={n.href} className="block border-b border-graphite px-4 py-3 text-[12px] font-medium uppercase tracking-[0.032em] text-bone last:border-b-0 hover:bg-graphite hover:text-citrine">
                  {n.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </NavShell>
    </header>
  );
}

const FOOTER = [
  { title: "Product", links: [{ href: "/product", label: "Capabilities" }, { href: "/architecture", label: "Architecture" }, { href: "/pricing", label: "Pricing" }, { href: "/changelog", label: "Changelog" }] },
  { title: "Developers", links: [{ href: "/docs/quickstart", label: "Quickstart" }, { href: "/docs/policies", label: "Policy reference" }, { href: "/docs/sdk/typescript", label: "TypeScript SDK" }, { href: "/docs/errors", label: "Error codes" }] },
  { title: "Trust", links: [{ href: "/security", label: "Security model" }, { href: "/attestation", label: "Attestation" }, { href: "/status", label: "Status" }] },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-graphite">
      <Container className="grid gap-12 py-20 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-5">
          <Wordmark />
          <p className="max-w-[34ch] text-sm leading-relaxed text-stone">Deterministic transaction security for autonomous agents on Robinhood Chain.</p>
          <p className="label">Chain ID 4663 · Testnet 46630</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="label mb-5">{col.title}</p>
            <ul className="space-y-3">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-bone/80 transition-colors hover:text-citrine">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <div aria-hidden className="select-none overflow-hidden px-4">
        <p className="translate-y-[18%] whitespace-nowrap text-center font-wordmark text-[11.5vw] font-normal leading-[0.8] tracking-[-0.04em] text-graphite">
          Palisec
        </p>
      </div>
      <Container className="relative flex flex-col gap-2 border-t border-graphite bg-carbon py-6 sm:flex-row sm:justify-between">
        <p className="label">Pre-release · No production deployment</p>
        <p className="label">No third-party tracking</p>
      </Container>
    </footer>
  );
}

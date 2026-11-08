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
      <span className="font-brand text-[18px] font-semibold tracking-[-0.03em] text-mist">Pali<span className="text-aqua">sec</span></span>
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
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-[4px] focus:bg-aqua focus:px-3 focus:py-1 focus:text-abyss">
        Skip to content
      </a>
      <NavShell>
        <Wordmark />
        <nav aria-label="Primary" className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="group relative font-utility text-[12px] font-medium uppercase tracking-[0.12em] text-silver transition-colors hover:text-platinum">
              {n.label}
              <span className="absolute -bottom-1.5 left-0 h-px w-full origin-left scale-x-0 bg-aqua shadow-[0_0_8px_#9cf6ee] transition-transform duration-500 ease-[var(--ease-out-quint)] group-hover:scale-x-100" />
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline-flex">
            <ButtonLink href="/console">Open Console</ButtonLink>
          </span>
          <details className="group relative lg:hidden">
            <summary className="btn btn-ghost h-10 w-10 cursor-pointer list-none items-center justify-center !p-0 [&::-webkit-details-marker]:hidden">
              <span className="sr-only group-open:hidden">Open menu</span>
              <span className="sr-only hidden group-open:inline">Close menu</span>
              {/* Three lines that fold into a cross when the menu opens. */}
              <span aria-hidden className="relative block h-3 w-4">
                <span className="absolute left-0 top-0 h-[1.5px] w-full rounded-full bg-current transition-transform duration-300 ease-[var(--ease-out-quint)] group-open:translate-y-[5.25px] group-open:rotate-45" />
                <span className="absolute left-0 top-[5.25px] h-[1.5px] w-full rounded-full bg-current transition-opacity duration-200 group-open:opacity-0" />
                <span className="absolute bottom-0 left-0 h-[1.5px] w-full rounded-full bg-current transition-transform duration-300 ease-[var(--ease-out-quint)] group-open:-translate-y-[5.25px] group-open:-rotate-45" />
              </span>
            </summary>
            <nav aria-label="Mobile" className="panel absolute right-0 top-12 w-60 animate-[fade-up_.25s_ease-out] overflow-hidden !rounded-[8px]">
              {[...NAV, { href: "/console", label: "Open Console" }].map((n) => (
                <Link key={n.href} href={n.href} className="block border-b border-line px-4 py-3 font-utility text-[11px] uppercase tracking-[0.08em] text-mist last:border-b-0 hover:bg-raised hover:text-aqua">
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
  { title: "Developers", links: [{ href: "/docs/quickstart", label: "Quickstart" }, { href: "/docs/policies", label: "Policy reference" }, { href: "/docs/sdk/typescript", label: "TypeScript SDK" }, { href: "/docs/errors", label: "Error codes" }, { href: "/login", label: "Sign in" }] },
  { title: "Trust", links: [{ href: "/security", label: "Security model" }, { href: "/attestation", label: "Attestation" }, { href: "/status", label: "Status" }, { href: "/terms", label: "Terms" }, { href: "/privacy", label: "Privacy" }] },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-deep">
      <div aria-hidden className="aurora bottom-[-30%] left-1/2 h-[360px] w-[900px] -translate-x-1/2 bg-aqua/[0.07]" />
      <Container className="grid grid-cols-2 gap-x-6 gap-y-12 py-20 md:grid-cols-[1.4fr_repeat(3,1fr)] md:py-[120px]">
        <div className="col-span-2 space-y-5 md:col-span-1">
          <Wordmark />
          <p className="max-w-[34ch] text-sm leading-relaxed text-silver">Deterministic transaction security for autonomous agents on Robinhood Chain.</p>
          <p className="label">Chain ID 4663 · Testnet 46630</p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="label mb-5">{col.title}</p>
            <ul className="space-y-3">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-mist/80 transition-colors hover:text-aqua">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="relative flex flex-col gap-2 border-t border-line py-6 sm:flex-row sm:justify-between">
        <p className="label">Pre-release · Robinhood Chain Testnet</p>
        <p className="label">No third-party tracking</p>
      </Container>
    </footer>
  );
}

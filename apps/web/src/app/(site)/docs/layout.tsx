import { DocsNavLink } from "@/components/docs-nav-link";
import { ChevronDownIcon } from "@/components/icons";
import { Container } from "@/components/ui";

const DOCS_NAV = [
  {
    title: "Start",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/api", label: "API reference" },
      { href: "/docs/policies", label: "Policy schema" },
      { href: "/docs/errors", label: "Errors and operations" },
      { href: "/docs/account-abstraction", label: "Account abstraction" },
    ],
  },
  {
    title: "SDKs and Connect",
    items: [
      { href: "/docs/sdk/typescript", label: "TypeScript" },
      { href: "/docs/sdk/python", label: "Python" },
      { href: "/docs/mcp", label: "MCP server" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/integrations", label: "Integrations and keys" },
    ],
  },
  {
    title: "PALISEC Agent",
    items: [{ href: "/docs/agent", label: "Agent" }],
  },
  {
    title: "Trust",
    items: [
      { href: "/architecture", label: "Architecture" },
      { href: "/security", label: "Security model" },
      { href: "/attestation", label: "Attestation" },
    ],
  },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container className="grid gap-10 py-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16 lg:py-16">
      <nav aria-label="Documentation" className="lg:sticky lg:top-24 lg:self-start">
        <details className="group/docs border border-line lg:border-0" open>
          <summary className="label flex cursor-pointer list-none items-center justify-between px-3 py-2 lg:hidden [&::-webkit-details-marker]:hidden">
            Documentation index
            <ChevronDownIcon size={14} className="transition-transform duration-300 group-open/docs:rotate-180" />
          </summary>
          <div className="space-y-6 p-3 lg:p-0">
            {DOCS_NAV.map((g) => (
              <div key={g.title}>
                <p className="label mb-2">{g.title}</p>
                <ul className="space-y-1 border-l border-line">
                  {g.items.map((i) => (
                    <li key={i.href}>
                      <DocsNavLink href={i.href}>{i.label}</DocsNavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </nav>
      <div className="min-w-0">{children}</div>
    </Container>
  );
}

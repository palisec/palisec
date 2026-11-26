import { DocsNavLink } from "@/components/docs-nav-link";
import { DocsBreadcrumb, DocsSearchBox, OnThisPage } from "@/components/line/docs-shell";

const DOCS_NAV = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/concepts", label: "Concepts" },
      { href: "/docs/quickstart", label: "Quickstart" },
      { href: "/docs/account-abstraction", label: "Smart accounts" },
    ],
  },
  {
    title: "Limits",
    items: [
      { href: "/docs/policies", label: "Policy schema" },
      { href: "/docs/loss-limits", label: "Loss limits" },
      { href: "/docs/treasury-guard", label: "Treasury guard" },
      { href: "/docs/mandates", label: "Holder mandates" },
      { href: "/docs/errors", label: "Reason codes and operations" },
    ],
  },
  {
    title: "Build",
    items: [
      { href: "/docs/sdk/typescript", label: "TypeScript SDK" },
      { href: "/docs/sdk/python", label: "Python SDK" },
      { href: "/docs/mcp", label: "MCP server" },
      { href: "/docs/api", label: "API reference" },
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/integrations", label: "Integrations and keys" },
      { href: "/docs/agent", label: "Palisec Agent" },
      { href: "/docs/token", label: "Token and credits" },
      { href: "/docs/zolva", label: "Zolva" },
      { href: "/docs/detect", label: "Detect a Palisec agent" },
    ],
  },
  {
    title: "Standard",
    items: [
      { href: "/docs/standard", label: "ERC-8511" },
      { href: "/architecture", label: "Architecture" },
      { href: "/security", label: "Security model" },
      { href: "/attestation", label: "Attestation" },
    ],
  },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="split pb-20 pt-[7.5rem]">
      <nav aria-label="Documentation" className="split-l min-w-0 lg:sticky lg:top-[6.875rem] lg:max-h-[calc(100dvh-8.125rem)] lg:self-start lg:overflow-y-auto">
        <DocsSearchBox />
        <details className="group/docs mt-6 lg:mt-8" open>
          <summary className="t-label cursor-pointer list-none py-2 lg:hidden [&::-webkit-details-marker]:hidden">Documentation index</summary>
          <div className="space-y-7">
            {DOCS_NAV.map((g) => (
              <div key={g.title}>
                <p className="t-label mb-2">{g.title}</p>
                <ul className="space-y-0.5">
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
      <div className="split-r grid min-w-0 gap-12 xl:grid-cols-[minmax(0,1fr)_12.5rem]">
        <div className="min-w-0">
          <DocsBreadcrumb nav={DOCS_NAV} />
          <div data-docs-article>{children}</div>
        </div>
        <OnThisPage />
      </div>
    </div>
  );
}

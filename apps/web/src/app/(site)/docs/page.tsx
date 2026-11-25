import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-icons";
import { DocArticle } from "@/components/doc";
import { AgentIcon, ArrowRightIcon, BellIcon, BookIcon, FileCheckIcon, KeyIcon, LayersIcon, LockIcon, PlugIcon, ShieldIcon, SlidersIcon, WalletIcon, ZapIcon } from "@/components/icons";
import { MaturityBadge } from "@/components/ui";
import { CAPABILITIES } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Guides and reference for the Palisec policy schema, authorization API, SDKs, MCP server, webhooks, the Palisec Agent and the security model.",
  alternates: { canonical: "/docs" }, openGraph: pageOpenGraph("/docs"),
};

const PATH: { href: string; icon: ReactNode; title: string; time: string }[] = [
  { href: "/docs/quickstart", icon: <ZapIcon size={20} />, title: "Run the quickstart", time: "10 min" },
  { href: "/docs/policies", icon: <SlidersIcon size={20} />, title: "Write a policy", time: "15 min" },
  { href: "/docs/sdk/typescript", icon: <PlugIcon size={20} />, title: "Connect your agent", time: "10 min" },
];

const TOPICS: { title: string; links: { href: string; label: string; icon: ReactNode; note: string }[] }[] = [
  {
    title: "Understand",
    links: [
      { href: "/docs/concepts", label: "Concepts", icon: <BookIcon size={18} />, note: "Policies, operations, decisions" },
      { href: "/architecture", label: "Architecture", icon: <LayersIcon size={18} />, note: "What runs where" },
      { href: "/security", label: "Security model", icon: <ShieldIcon size={18} />, note: "Threats and boundaries" },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/docs/api", label: "REST API", icon: <BrandMark brand="openapiinitiative" size={18} />, note: "Endpoints and schemas" },
      { href: "/docs/policies", label: "Policy schema", icon: <FileCheckIcon size={18} />, note: "Every rule, version 1.0" },
      { href: "/docs/errors", label: "Errors", icon: <KeyIcon size={18} />, note: "Reason codes, retries" },
      { href: "/docs/account-abstraction", label: "Smart accounts", icon: <WalletIcon size={18} />, note: "ERC-4337 enforcement" },
    ],
  },
  {
    title: "Connect",
    links: [
      { href: "/docs/sdk/typescript", label: "TypeScript", icon: <BrandMark brand="typescript" size={18} />, note: "@palisec/sdk" },
      { href: "/docs/sdk/python", label: "Python", icon: <BrandMark brand="python" size={18} />, note: "palisec" },
      { href: "/docs/mcp", label: "MCP server", icon: <BrandMark brand="modelcontextprotocol" size={18} />, note: "Streamable HTTP" },
      { href: "/docs/webhooks", label: "Webhooks", icon: <BellIcon size={18} />, note: "Signed events" },
      { href: "/docs/integrations", label: "Keys", icon: <LockIcon size={18} />, note: "Scopes and rotation" },
    ],
  },
  {
    title: "Operate",
    links: [{ href: "/docs/agent", label: "Palisec Agent", icon: <AgentIcon size={18} />, note: "Tools and autonomy" }],
  },
];

export default function DocsIndex() {
  return (
    <DocArticle title="Documentation" lede="Each page marks what runs today and what is still specified." maturity="service" compat="Schema 1.0 · docs revision 2026-11">
      <div className="not-prose">
        <p className="label mb-3">Start here</p>
        <ol className="grid gap-3 sm:grid-cols-3">
          {PATH.map((p, i) => (
            <li key={p.href}>
              <Link href={p.href} className="group flex h-full flex-col gap-6 rounded-[0.75rem] border border-line-strong bg-deep/70 p-4 transition-colors hover:border-aqua/45 hover:bg-raised/60">
                <span className="flex items-center justify-between">
                  <span aria-hidden className="text-aqua">{p.icon}</span>
                  <span className="font-mono text-[0.75rem] text-dim">{String(i + 1).padStart(2, "0")}</span>
                </span>
                <span>
                  <span className="block text-[0.9688rem] font-medium text-mist">{p.title}</span>
                  <span className="mt-0.5 block text-[0.8125rem] text-muted">{p.time}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {TOPICS.map((t) => (
            <div key={t.title} id={t.title.toLowerCase()} className="scroll-mt-28">
              <p className="label mb-2">{t.title}</p>
              <ul className="border-t border-line">
                {t.links.map((l) => (
                  <li key={l.href} className="border-b border-line">
                    <Link href={l.href} className="group flex items-center gap-3 py-3">
                      <span aria-hidden className="text-silver transition-colors group-hover:text-aqua">{l.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-medium text-mist transition-colors group-hover:text-aqua">{l.label}</span>
                        <span className="block text-[0.8125rem] text-muted">{l.note}</span>
                      </span>
                      <ArrowRightIcon size={16} className="text-dim transition-all group-hover:translate-x-1 group-hover:text-aqua" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <h2>What exists today</h2>
      <div className="not-prose divide-y divide-line border-y border-line">
        {CAPABILITIES.map((c) => (
          <details key={c.id} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 text-[0.9062rem] text-mist">{c.name}</span>
              <MaturityBadge maturity={c.maturity} />
              <ArrowRightIcon size={14} className="text-dim transition-transform group-open:rotate-90" />
            </summary>
            <p className="pb-4 pr-10 text-[0.875rem] leading-relaxed text-silver">{c.note}</p>
          </details>
        ))}
      </div>
    </DocArticle>
  );
}

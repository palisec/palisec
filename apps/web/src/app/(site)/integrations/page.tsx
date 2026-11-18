import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { MaturityBadge, PageHeader, Section } from "@/components/ui";
import { capability } from "@/lib/capabilities";

export const metadata: Metadata = {
  title: "Integrations",
  description: "PALISEC Connect: integrate independently built agents through the TypeScript and Python SDKs, the REST API, the MCP server and signed webhooks, with scoped, revocable credentials.",
  alternates: { canonical: "/integrations" }, openGraph: pageOpenGraph("/integrations"),
};

const SURFACES = [
  { name: "TypeScript SDK", cap: "sdk-ts", href: "/docs/sdk/typescript", body: "@palisec/sdk with viem or ethers. sendTransaction authorizes and sends only on ALLOW, refuses a wallet on the wrong chain or account." },
  { name: "Python SDK", cap: "sdk-py", href: "/docs/sdk/python", body: "palisec for async Python, standard library only, with a web3.py sender. Same semantics as the TypeScript SDK." },
  { name: "REST API", cap: "api", href: "/docs/api", body: "OpenAPI 3.1. Idempotent authorizations, dry runs, operation status, the agent's policy and audit trail." },
  { name: "MCP server", cap: "mcp", href: "/docs/mcp", body: "Streamable HTTP at /api/mcp with the official MCP SDK. Tools for evaluation, proposals, status, explanations and policy validation." },
  { name: "Webhooks", cap: "webhooks", href: "/docs/webhooks", body: "Signed events for decisions, approvals, pauses, stops and security findings, with stable event IDs for deduplication." },
] as const;

const SCOPES = [
  ["operations:write", "Request authorizations and dry runs; withdraw its own pending approvals"],
  ["operations:read", "Read its own operations and their status"],
  ["policy:read", "Read the exact policy version it is evaluated against"],
  ["audit:read", "Read the audit events it caused"],
  ["mcp", "Connect through the MCP server"],
];

const CANNOT = [
  "Access another organization's accounts or records",
  "Change its own scopes or register a signer",
  "Disable policy enforcement or bypass human approval",
  "Use a revoked or rotated key, or reuse an expired authorization",
  "Reach signing secrets, or activate, approve or sign anything",
];

const TOOL = `import { createPalisec, createPalisecTools } from "@palisec/sdk";

// Framework-neutral tools: name, description, JSON Schema, execute.
// The framework decides what to try; PALISEC decides whether it may be sent.
const tools = createPalisecTools(createPalisec({ apiKey: process.env.PALISEC_API_KEY! }), { wallet });

// OpenAI Agents SDK
new Agent({ name: "trader", tools: tools.map((t) => tool({ ...t, strict: false })) });
// Vercel AI SDK
Object.fromEntries(tools.map((t) => [t.name, aiTool({ description: t.description, inputSchema: jsonSchema(t.parameters), execute: t.execute })]));
// LangGraph / LangChain
tools.map((t) => new DynamicStructuredTool({ name: t.name, description: t.description, schema: t.parameters, func: t.execute }));`;

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        eyebrow="PALISEC Connect"
        title="Bring your own agent. Keep the security boundary."
        lede="Your agent keeps its reasoning and workflow. PALISEC provides the authorization and protected-execution layer, the same way through every interface. Independent agents never need the native PALISEC Agent."
      />

      <Section label="External agent architecture">
        <pre className="panel overflow-x-auto p-6 font-mono text-[12.5px] leading-[1.9] text-soft">{`Your agent (any framework, any language)
   │  intent: to · value · data · gas limit · request ID
   ▼
TypeScript SDK │ Python SDK │ REST API │ MCP server     ← authenticated integration principal (scoped API key)
   │
   ▼
PALISEC authorization: deterministic engine · atomic reservation · replay · approvals
   │                                  └─ webhooks: signed events to your systems
   ▼
ALLOW → your agent sends exactly that transaction · DENY → nothing is sent · REVIEW → a human signs first`}</pre>
      </Section>

      <Section label="Interfaces">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SURFACES.map((s) => (
            <Link key={s.name} href={s.href} className="panel flex flex-col p-6 transition-colors hover:border-aqua/50">
              <div className="mb-5 flex items-center justify-between gap-2">
                <h3 className="font-heading text-[21px] font-medium text-mist">{s.name}</h3>
                <MaturityBadge maturity={capability(s.cap).maturity} />
              </div>
              <p className="text-[14px] leading-relaxed text-silver">{s.body}</p>
            </Link>
          ))}
        </div>
      </Section>

      <Section label="Framework adapters" id="frameworks">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-4 text-[15.5px] leading-relaxed text-silver">
            <div className="flex items-center gap-3">
              <h3 className="font-heading text-[24px] font-medium text-mist">OpenAI Agents SDK, LangGraph, Vercel AI SDK</h3>
            </div>
            <MaturityBadge maturity={capability("framework-adapters").maturity} />
            <p><code>createPalisecTools</code> in the TypeScript SDK gives every framework the same tested tools: evaluate, send (only on ALLOW), read an operation, explain a reason code. There is no framework-specific security logic, and MCP-capable frameworks can use the MCP server instead.</p>
            <p>The core SDKs stay framework-independent on purpose.</p>
          </div>
          <CodeBlock code={TOOL} title="tools.ts" />
        </div>
      </Section>

      <Section label="Authentication and permission scopes">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <p className="text-[15.5px] leading-relaxed text-silver">
              Each integration is a registered agent bound to one protected account and policy. Its API keys are shown once, stored only as SHA-256 hashes, and can be narrowed to the scopes it
              needs, rotated atomically or revoked instantly. A name is not an identity: the key is.
            </p>
            <dl className="mt-6 divide-y divide-line border-y border-line">
              {SCOPES.map(([k, v]) => (
                <div key={k} className="grid gap-1 py-3 sm:grid-cols-[170px_1fr]">
                  <dt className="font-mono text-[13px] text-mist">{k}</dt>
                  <dd className="text-[14px] text-silver">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="panel p-6">
            <p className="label mb-4">An integration can never</p>
            <ul className="space-y-2.5 text-[14.5px] text-silver">
              {CANNOT.map((c) => (
                <li key={c} className="flex gap-3">
                  <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-deny" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <Section label="Integration examples">
        <ul className="divide-y divide-line border-y border-line">
          {[
            ["Quickstart: first authorized operation", "/docs/quickstart"],
            ["TypeScript: send only on ALLOW with viem or ethers", "/docs/sdk/typescript"],
            ["Python: async client with web3.py", "/docs/sdk/python"],
            ["MCP: connect an MCP client to PALISEC", "/docs/mcp"],
            ["Webhooks: verify signatures and deduplicate", "/docs/webhooks"],
            ["Integrations: scopes, rotation and the agent's own endpoints", "/docs/integrations"],
          ].map(([t, h]) => (
            <li key={h}>
              <Link href={h} className="flex items-center justify-between py-4 text-[15.5px] text-mist transition-colors hover:text-aqua">
                {t} <span aria-hidden className="text-dim">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

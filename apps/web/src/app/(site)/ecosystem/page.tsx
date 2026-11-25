import type { Metadata } from "next";
import Link from "next/link";
import { pageOpenGraph } from "@/lib/seo";
import { NETWORKS, MAINNET } from "@/lib/networks";
import { Accent, Framed, Label, Rows } from "@/components/line/parts";
import { PageHead, Split } from "@/components/line/split";

export const metadata: Metadata = {
  title: "Ecosystem",
  description: "Whatever framework your agent runs on, Palisec authorizes it the same way: TypeScript and Python SDKs, MCP, OpenAI Agents SDK, LangGraph, Vercel AI SDK and REST.",
  alternates: { canonical: "/ecosystem" },
  openGraph: pageOpenGraph("/ecosystem"),
};

const EXPLORER = NETWORKS[MAINNET].explorer;
const AGENT_LINKS = "0x737f1AcF46acE6d403977eB4944845fD251fC8C6";

const FRAMEWORKS = [
  { name: "TypeScript SDK", text: "@palisec/sdk for viem or ethers: check, then send only on ALLOW.", href: "/docs/sdk/typescript" },
  { name: "Python SDK", text: "palisec on PyPI, async, with the same decisions and reason codes.", href: "/docs/sdk/python" },
  { name: "MCP server", text: "Any MCP-compatible agent asks Palisec through the same authorization path.", href: "/docs/mcp" },
  { name: "OpenAI Agents SDK", text: "A tool that asks Palisec before the agent signs anything.", href: "/docs/integrations" },
  { name: "LangGraph", text: "A node that checks each transaction before it is sent.", href: "/docs/integrations" },
  { name: "Vercel AI SDK", text: "A tool wrapper: the model proposes, Palisec decides.", href: "/docs/integrations" },
  { name: "REST API", text: "Plain HTTPS with scoped keys, idempotency and stable reason codes.", href: "/docs/api" },
];

export default function EcosystemPage() {
  return (
    <>
      <PageHead
        label="Ecosystem"
        title={<>Bring your own agent. <Accent>Keep the boundary.</Accent></>}
        lede="Whatever framework your agent runs on, Palisec authorizes it the same way."
      />
      <Split
        left={<Label>Frameworks and interfaces</Label>}
        right={
          <Rows>
            {FRAMEWORKS.map((f) => (
              <li key={f.name}>
                <Link href={f.href} className="group grid gap-1 py-5 sm:grid-cols-[15rem_1fr_auto] sm:items-baseline sm:gap-6">
                  <span className="font-utility text-[1.0625rem] font-medium text-mist group-hover:text-aqua">{f.name}</span>
                  <span className="t-body">{f.text}</span>
                  <span aria-hidden className="text-dim group-hover:text-aqua">→</span>
                </Link>
              </li>
            ))}
          </Rows>
        }
      />
      <Split
        left={<Label>Partners</Label>}
        right={
          <Framed className="space-y-5 p-7">
            <p className="t-h3">Zolva</p>
            <p className="t-body">
              Zolva agents linked to a Palisec account show a verified track record. The link is proven from both sides: the Palisec agent names its Zolva agent, and the
              Zolva agent names its Palisec account.
            </p>
            <p className="font-mono text-[0.8438rem] text-silver">
              AgentLinks{" "}
              <a href={`${EXPLORER}/address/${AGENT_LINKS}`} target="_blank" rel="noopener noreferrer" className="text-aqua hover:underline">
                {AGENT_LINKS.slice(0, 6)}…{AGENT_LINKS.slice(-4)} ↗
              </a>{" "}
              · linked on chain
            </p>
            <Link href="/docs/zolva" className="inline-block font-mono text-[0.8125rem] text-silver hover:text-aqua">How the link works →</Link>
          </Framed>
        }
      />
    </>
  );
}

import type { Metadata } from "next";
import { Note, PageHeader, Section } from "@/components/ui";
import { mainnetEnabled } from "@/server/config";
import { HealthCheck } from "./health-check";

export const metadata: Metadata = {
  title: "Status",
  description: "What Palisec runs today, and a live health check of the deployed services.",
  alternates: { canonical: "/status" },
};

const services = (mainnet: boolean): { name: string; deployed: boolean; note: string }[] => [
  { name: "Authorization API", deployed: true, note: mainnet ? "Mainnet 4663 and testnet 46630" : "Testnet 46630 (mainnet 4663 is built and off)" },
  { name: "Policy engine", deployed: true, note: "Rust engine (WebAssembly) and the reference evaluator; both must agree or the request is denied" },
  { name: "Control plane and console", deployed: true, note: "Wallet sign-in, agents, policies, approvals, audit" },
  { name: "MCP server", deployed: true, note: "Streamable HTTP at /api/mcp" },
  { name: "Webhooks and security events", deployed: true, note: "Signed deliveries; deterministic detectors on demand" },
  { name: "PALISEC Agent", deployed: true, note: "Model provider: Groq free tier, when PALISEC_AGENT_API_KEY is configured" },
  { name: "Signing enclave", deployed: false, note: "" },
  { name: "Smart-account co-signing and bundler", deployed: true, note: mainnet ? "Mainnet and testnet, a separate co-signer key for each: Safe + 4337 module, Alchemy bundler" : "Testnet: Safe + 4337 module, Alchemy bundler" },
  { name: "Telemetry ingestion", deployed: false, note: "" },
];

export default function StatusPage() {
  const mainnet = mainnetEnabled();
  const SERVICES = services(mainnet);
  return (
    <>
      <PageHeader
        eyebrow="Status"
        title={mainnet ? "Mainnet and testnet, pre-release." : "Testnet, pre-release."}
        lede={
          mainnet
            ? "The authorization API, console and smart-account execution run on Robinhood Chain mainnet and testnet, each with its own co-signer key. The signing enclave is a later upgrade. Live status comes only from a real health check."
            : "The authorization API, console and smart-account execution run on Robinhood Chain Testnet. Mainnet support is built and switched off. Live status comes only from a real health check."
        }
      />
      <Section label="Services">
        <ul className="divide-y divide-line border-y border-line">
          {SERVICES.map((s) => (
            <li key={s.name} className="flex flex-wrap items-center justify-between gap-4 py-4">
              <span className="text-fg">
                {s.name}
                {s.note && <span className="ml-3 text-sm text-muted">{s.note}</span>}
              </span>
              <span className={`font-mono text-[11px] tracking-[0.08em] ${s.deployed ? "text-allow" : "text-dim"}`}>{s.deployed ? "● DEPLOYED" : "○ NOT DEPLOYED"}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section label="Live check">
        <HealthCheck />
        <Note title="Service objectives">
          API availability, authorization latency, recovery time and telemetry lag objectives will be published only after they are
          measured and supported by the deployment architecture. The hosting plan is not suited to production funds.
        </Note>
      </Section>
    </>
  );
}

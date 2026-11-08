import type { Metadata } from "next";
import { Note, PageHeader, Section } from "@/components/ui";
import { HealthCheck } from "./health-check";

export const metadata: Metadata = {
  title: "Status",
  description: "What Palisec runs today, and a live health check of the deployed services.",
  alternates: { canonical: "/status" },
};

const SERVICES: { name: string; deployed: boolean; note: string }[] = [
  { name: "Authorization API", deployed: true, note: "Testnet 46630" },
  { name: "Policy engine", deployed: true, note: "Rust engine (WebAssembly) and the reference evaluator; both must agree or the request is denied" },
  { name: "Control plane and console", deployed: true, note: "Wallet sign-in, agents, policies, approvals, audit" },
  { name: "Signing enclave", deployed: false, note: "" },
  { name: "Chain worker · bundler", deployed: false, note: "" },
  { name: "Telemetry ingestion", deployed: false, note: "" },
];

export default function StatusPage() {
  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="Testnet, pre-release."
        lede="The authorization API and console run on Robinhood Chain Testnet. Signing, submission and the on-chain module are not deployed. Live status comes only from a real health check."
      />
      <Section index="01" label="Services">
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
      <Section index="02" label="Live check">
        <HealthCheck />
        <Note title="Service objectives">
          API availability, authorization latency, recovery time and telemetry lag objectives will be published only after they are
          measured and supported by the deployment architecture. The hosting plan is not suited to production funds.
        </Note>
      </Section>
    </>
  );
}

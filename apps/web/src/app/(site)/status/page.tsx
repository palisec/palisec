import type { Metadata } from "next";
import { Note, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Status",
  description: "Verified operational status for Palisec services. No production services are deployed yet.",
  alternates: { canonical: "/status" },
};

const SERVICES = ["Authorization API", "Policy engine", "Signing enclave", "Chain worker · bundler", "Approval worker", "Telemetry ingestion"];

export default function StatusPage() {
  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="Not deployed."
        lede="Status is reported only from real health checks. There are no production services yet, so there is nothing to report as up or down."
      />
      <Section index="01" label="Services">
        <ul className="divide-y divide-line border-y border-line">
          {SERVICES.map((s) => (
            <li key={s} className="flex items-center justify-between gap-4 py-4">
              <span className="text-fg">{s}</span>
              <span className="font-mono text-[11px] tracking-[0.08em] text-dim">○ NOT DEPLOYED</span>
            </li>
          ))}
        </ul>
        <Note title="Service objectives">
          API availability, authorization and signing latency, recovery time and telemetry lag objectives will be published only
          after they are measured and supported by the deployment architecture.
        </Note>
      </Section>
    </>
  );
}

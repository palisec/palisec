import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { Note, PageHeader, Section } from "@/components/ui";
import { mainnetEnabled } from "@/server/config";
import { LiveStatus } from "./live-status";

export const metadata: Metadata = {
  title: "Status",
  description: "The live state of every Palisec service, from a real health check.",
  alternates: { canonical: "/status" }, openGraph: pageOpenGraph("/status"),
};

export default function StatusPage() {
  const mainnet = mainnetEnabled();
  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="Service status."
        lede={
          mainnet
            ? "Every badge below comes from a live health check run when this page opens. Mainnet · real funds · start with small balances."
            : "Every badge below comes from a live health check run when this page opens. Mainnet is switched off by the operator; testnet runs."
        }
      />
      <Section label="Services">
        <LiveStatus />
        <Note title="What the states mean">
          Operational: a live check passed. Not running: a check failed, with the reason. Unknown: the health check could not be
          reached, so nothing is assumed. Deployed · unchecked: running, but only its configuration is checked. Roadmap: not built yet.
          Availability and latency objectives are published only once they are measured.
        </Note>
      </Section>
    </>
  );
}

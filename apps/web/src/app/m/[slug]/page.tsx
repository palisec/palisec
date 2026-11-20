import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Section } from "@/components/ui";
import { publicMandate } from "@/server/mandates";
import { MandateLive, type PublicMandate } from "./mandate-live";

export const metadata: Metadata = {
  title: "Holder mandate",
  description: "A holder mandate on Palisec: limits set by token holders' votes and enforced by Palisec's co-signer.",
  robots: { index: false },
};

/** Phase 7: a mandate's public page. Signed out, real data only (database and chain); refreshes itself. */
export default function MandatePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={<PageHeader title="Holder mandate" lede="Loading the mandate from Palisec's records…" />}>
      <MandateBody params={params} />
    </Suspense>
  );
}

async function MandateBody({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  let data: PublicMandate;
  try {
    data = (await publicMandate(slug)) as unknown as PublicMandate;
  } catch {
    notFound();
  }
  return (
    <>
      <PageHeader
        title={data.name}
        lede={
          <>
            Holders of ${data.token.symbol} vote on this agent&apos;s limits; Palisec enforces the result. The agent&apos;s account can only move
            funds with Palisec&apos;s co-signature, which follows the active limits below.
          </>
        }
      />
      <Section label="Mandate">
        <MandateLive slug={slug} initial={data} />
      </Section>
    </>
  );
}

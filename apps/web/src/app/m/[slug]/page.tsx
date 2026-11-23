import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader, Section } from "@/components/ui";
import { requireMandatesVisible } from "@/server/mandate-access";
import { publicMandate } from "@/server/mandates";
import { MandateLive, type PublicMandate } from "./mandate-live";

export const metadata: Metadata = {
  title: "Holder mandate",
  description: "Token holders vote on an agent's limits inside an owner-set envelope; Palisec enforces the result. Live counts, vote files and decisions.",
};

/** Holder mandates: a mandate's public page. Signed out, real data only (database and chain); refreshes itself. */
export default function MandatePage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <MandateBody params={params} />
    </Suspense>
  );
}

async function MandateBody({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  let data: PublicMandate;
  try {
    // Public unless MANDATES_PUBLIC=0 (then signed-in sessions only; everyone else gets "not found").
    await requireMandatesVisible(new Request("https://palisec.tech/m", { headers: await headers() }));
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

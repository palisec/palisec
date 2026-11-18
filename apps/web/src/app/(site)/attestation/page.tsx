import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { Codes, Note, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "Attestation",
  description: "TEE measurements and how Palisec verifies enclave attestation. No enclave is deployed yet.",
  alternates: { canonical: "/attestation" }, openGraph: pageOpenGraph("/attestation"),
};

const STEPS = [
  ["Reproducible build", "The enclave image is built reproducibly; anyone can recompute PCR0–PCR2."],
  ["Document verification", "The attestation document is verified against the AWS Nitro root and certificate chain."],
  ["Freshness and nonce", "Each verification uses a fresh nonce; stale documents are rejected (PS_ATTEST_001)."],
  ["Measurement match", "PCR values must equal the published, approved measurements."],
  ["Signer binding", "The signing public key is bound to the verified document and authorized deployment configuration."],
  ["On-chain trust", "The smart account trusts the registered signer, not the PCR value itself."],
];

export default function AttestationPage() {
  return (
    <>
      <PageHeader
        compat="Schema 1.0 · enclave signing on the roadmap"
        eyebrow="Attestation"
        title="Measurements, and what they do and do not prove."
        lede="This page will publish expected enclave measurements and the latest verification result, with its scope and timestamp."
      />
      <Section label="Current measurements">
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="label">Enclave · production</p>
            <p className="font-utility text-[13px] font-semibold text-review">No enclave deployed yet</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] font-mono text-xs">
            {["PCR0 · image", "PCR1 · kernel", "PCR2 · application", "Signer public key", "Last verified"].map((k) => (
              <div key={k} className="contents">
                <dt className="border-b border-line px-4 py-3 text-muted"><Codes text={k} /></dt>
                <dd className="border-b border-line px-4 py-3 text-dim">— unavailable</dd>
              </div>
            ))}
          </dl>
        </div>
        <Note title="Why empty">
          Values appear only when a measured build is deployed and verified. Placeholder hashes would be indistinguishable from real
          ones, so none are shown.
        </Note>
      </Section>
      <Section label="Verification procedure">
        <ol className="divide-y divide-line border-y border-line">
          {STEPS.map(([k, v], i) => (
            <li key={k} className="grid gap-2 py-4 md:grid-cols-[3rem_220px_1fr]">
              <span className="font-mono text-xs text-dim">{String(i + 1).padStart(2, "0")}</span>
              <span className="text-fg">{k}</span>
              <span className="text-sm text-muted"><Codes text={v} /></span>
            </li>
          ))}
        </ol>
        <Note kind="warning" title="Scope">
          A matching PCR value proves which code a particular enclave was running when it was attested. It does not, by itself,
          prove that every transaction is enforced by that enclave. That guarantee comes from the smart account accepting only the
          bound signer.
        </Note>
      </Section>
    </>
  );
}

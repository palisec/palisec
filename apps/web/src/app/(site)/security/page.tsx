import type { Metadata } from "next";
import { Note, PageHeader, Section } from "@/components/ui";

const INCIDENT: [string, string][] = [
  ["Contain", "Engage the global stop or pause the affected agent through the independent control path. New authorizations are denied immediately; nothing already denied can be signed."],
  ["Revoke", "Revoke compromised API credentials and, where needed, the signing identity registered with the smart account. Revocation of a signer is an on-chain action."],
  ["Investigate", "Reconstruct the timeline from the append-only audit trail by request ID, policy version and reason code. Reservations show what was authorized but not finalized."],
  ["Recover", "Release the stop only after health checks pass and an authorized operator confirms. Enclave or measurement changes are re-attested before signing resumes."],
  ["Disclose", "Notify affected organizations with the scope, the window and the audit references. Publish a post-incident note in the changelog."],
  ["Learn", "Add an adversarial test that reproduces the incident and a release gate that blocks its regression."],
];

export const metadata: Metadata = {
  title: "Security model",
  description: "Threats Palisec addresses, what the TEE does and does not guarantee, key design and release gates.",
  alternates: { canonical: "/security" },
};

const THREATS = [
  "An agent repeatedly submits identical or semantically equivalent transactions.",
  "A compromised agent tries to exceed a transaction, hourly, daily or per-token budget.",
  "A developer API key is stolen.",
  "An attacker replays an earlier approved request or UserOperation.",
  "An unauthorized user submits a policy update.",
  "Concurrent requests race to spend the same budget.",
  "The primary application server is compromised.",
  "An enclave restarts, loses state or becomes unreachable.",
  "RPC, bundler, fee estimator or indexer returns stale or inconsistent data.",
  "A human approval expires, is replayed, or is applied to a different transaction.",
  "A transaction changes materially between policy check and signing.",
  "A whitelisted contract is upgraded or changes behaviour.",
];

const TEE = [
  "Contains signing, the policy code that authorizes it, and the minimum sensitive state for those checks.",
  "Talks to its parent over a narrow, authenticated protocol with bounded message sizes and no arbitrary-signing request.",
  "Is built reproducibly; expected measurements are published and attestation documents are verified against the AWS trust chain with nonce and freshness checks.",
  "Binds its signing identity to the verified attestation and the authorized deployment configuration.",
  "Refuses new signing after a restart until state integrity is re-established and pending operations are reconciled.",
];

const KEYS = [
  ["Generation", "Inside the enclave. Never exported, logged or returned by any API."],
  ["Registration", "Public key registered with the smart account's validation module."],
  ["Scope", "Bound to one account and chain; cannot authorize outside policy."],
  ["Rotation and revocation", "Controlled, authenticated, recorded; revocation is enforced on chain."],
  ["Measurement change", "New build → new attestation → explicit approval before the signer is trusted."],
  ["Environments", "Separate keys for development, staging and production."],
];

const GATES = [
  "Reviewed threat model",
  "Audited smart-account enforcement design",
  "Attestation verification test suite",
  "Key management and recovery procedures",
  "Budget-concurrency and replay tests",
  "Direct-bypass tests",
  "Dependency and secret scanning",
  "Contract fuzzing and invariant tests",
  "Documented incident response",
  "Tested rollback procedure",
  "No unresolved critical findings",
];

const BOUNDARIES: [string, string][] = [
  ["A · External agent → PALISEC", "External agents are untrusted callers. Every request is validated and authenticated with a scoped key; organization and account boundaries are enforced on the server. Claims in prompts or tool arguments are never trusted."],
  ["B · Model → PALISEC tools", "The model is not an authorization principal. Tool availability is not permission: the server independently checks the signed-in member's role and organization for every call, and verifies every identifier."],
  ["C · Native agent → control plane", "The agent has no administrator rights. Sensitive actions become requests a member confirms; they run through the existing control-plane functions under that member's identity."],
  ["D · Agent → signing", "No path exists. The agent never receives PALISEC's co-signing key or enclave secrets; PALISEC co-signs only after its own decision. On testnet the co-signer is a server-held key; the enclave signer is specified, not deployed."],
  ["E · PALISEC API → smart account", "The account enforces the authorization independently: a Safe with threshold 2 and PALISEC's co-signer as an owner rejects anything PALISEC did not co-sign. Live on testnet. A compromised API on testnet could co-sign, which is why mainnet signing belongs in the enclave."],
];

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        compat="Schema 1.0 · pre-release · testnet · enclave signing not deployed"
        eyebrow="Security model"
        title="What it protects, what it assumes, and where it stops."
        lede="Security decisions come from executable policies, never from a model's reading of a warning. Anything ambiguous, failed or unverifiable results in no signature."
      />
      <Section label="Threats addressed">
        <ol className="grid gap-px border border-line bg-line md:grid-cols-2">
          {THREATS.map((t, i) => (
            <li key={t} className="flex gap-4 bg-ink p-4 text-sm leading-relaxed text-soft">
              <span className="font-mono text-xs text-dim">T{String(i + 1).padStart(2, "0")}</span>
              {t}
            </li>
          ))}
        </ol>
      </Section>
      <Section label="TEE guarantees">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <h3 className="text-2xl font-medium leading-tight text-fg">The enclave is a component, not a guarantee.</h3>
            <Note kind="warning" title="Limits">
              A TEE does not prevent every compromise, side channel, misconfiguration or supply-chain attack. An attestation page
              that shows a PCR hash is informational; it does not prove that every transaction passes through that enclave.
            </Note>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {TEE.map((t) => <li key={t} className="py-4 text-sm leading-relaxed text-soft">{t}</li>)}
          </ul>
        </div>
      </Section>
      <Section label="Signing keys">
        <dl className="divide-y divide-line border-y border-line">
          {KEYS.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-4 md:grid-cols-[240px_1fr]">
              <dt className="text-fg">{k}</dt>
              <dd className="text-sm text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section label="Production release gates">
        <p className="mb-6 max-w-[60ch] text-sm leading-relaxed text-muted">
          No production release proceeds until every gate is met. None are met today: Palisec is pre-release.
        </p>
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {GATES.map((g) => (
            <li key={g} className="flex items-center justify-between gap-3 bg-ink px-4 py-3 text-sm text-soft lg:last:[&:nth-child(3n+2)]:col-span-2 sm:max-lg:last:[&:nth-child(odd)]:col-span-2">
              {g}
              <span className="shrink-0 font-mono text-[10px] tracking-[0.08em] text-review">□ OPEN</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section label="Incident response">
        <ol className="grid gap-px border border-line bg-line md:grid-cols-2">
          {INCIDENT.map(([k, v], i) => (
            <li key={k} className="bg-ink p-5">
              <p className="flex items-baseline gap-3 text-fg"><span className="font-mono text-xs text-dim">{String(i + 1).padStart(2, "0")}</span>{k}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">{v}</p>
            </li>
          ))}
        </ol>
        <div id="disclosure" className="mt-10 max-w-[68ch] scroll-mt-28 space-y-3 text-sm leading-relaxed text-muted">
          <p className="label !text-mist">Reporting a vulnerability</p>
          <p>
            Email <a href="mailto:security@palisec.tech" className="text-mist underline decoration-aqua/60 underline-offset-4 hover:text-aqua">security@palisec.tech</a> with
            the affected component, steps to reproduce and the impact you observed. Do not open a public issue. We acknowledge reports within
            three working days and credit researchers who ask to be named.
          </p>
          <p>
            Test only against your own organization on testnet. Do not access other organizations&apos; data, degrade the service, or use real
            funds. Good-faith research within these rules will not be pursued. Machine-readable contact:{" "}
            <a href="/.well-known/security.txt" className="text-mist underline decoration-aqua/60 underline-offset-4 hover:text-aqua">security.txt</a>.
          </p>
        </div>
      </Section>
      <Section label="Agentic trust boundaries" id="agentic">
        <dl className="divide-y divide-line border-y border-line">
          {BOUNDARIES.map(([k, v]) => (
            <div key={k} className="grid gap-2 py-5 md:grid-cols-[300px_1fr]">
              <dt className="text-fg">{k}</dt>
              <dd className="text-sm leading-relaxed text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section label="Prompt injection and untrusted data" id="injection">
        <div className="grid gap-8 lg:grid-cols-2">
          <p className="text-[15.5px] leading-relaxed text-silver">
            The PALISEC Agent reads agent names, transaction metadata, audit details and documentation, any of which may contain hostile text. That content reaches the model only inside tool results, marked as untrusted data. The system prompt is not the defence: the tools are.
          </p>
          <ul className="space-y-2.5 text-[14.5px] text-silver">
            {["Strict tool schemas and server-side input validation", "Least-privilege tools per role and autonomy level, re-checked on every call", "No tool that signs, approves, activates or changes permissions", "Sensitive actions only as requests a person confirms", "Context minimization and secret redaction before the model", "Every tool call recorded and audited; rate limits per member", "Tested: an injected instruction cannot call a refused tool or escalate"].map((x) => (
              <li key={x} className="flex gap-3">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 bg-aqua" />
                {x}
              </li>
            ))}
          </ul>
        </div>
      </Section>
    </>
  );
}

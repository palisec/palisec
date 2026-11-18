import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { REASON_CODES, RETRYABLE, type ReasonCode } from "@palisec/policy-schema";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Codes, Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Errors and operations",
  description: "Stable Palisec reason codes, retry semantics, operation states and failure behaviour.",
  alternates: { canonical: "/docs/errors" }, openGraph: pageOpenGraph("/docs/errors"),
};

const STATES = [
  ["evaluated", "Policy decision recorded. Nothing signed."],
  ["pending_approval", "Awaiting an independent human signature over this exact operation."],
  ["authorized", "Authorization bound to op hash, chain, policy version and expiry."],
  ["signed", "Signed by the protected signer. Not yet submitted."],
  ["submitted", "Accepted by the bundler. Reservation still held."],
  ["included", "In a block. Awaiting finality; reorgs are reconciled."],
  ["succeeded / reverted", "Final execution outcome. Reservation finalized with actual fee."],
  ["denied / expired / rejected", "Terminal. Reservation released. No transaction hash."],
];

const FAILURES = [
  ["Policy unavailable", "Do not authorize new signing."],
  ["State store unavailable", "Do not approve on stale counters (PS_STATE_001)."],
  ["Enclave unavailable", "Typed unavailable error. Never fall back to an unprotected signer."],
  ["Fee estimation unavailable", "Deny or require review per policy (PS_FEE_001)."],
  ["Bundler unavailable", "Preserve operation state and reservation until reconciled (PS_CHAIN_001)."],
  ["Telemetry unavailable", "Buffer bounded, redacted events. Decisions are unaffected."],
  ["RPC disagreement", "Do not finalize on an unverified receipt."],
  ["Approval expires", "Invalidate the pending authorization."],
  ["Duplicate request", "Return the existing idempotent result, or PS_REPLAY_001."],
];

const DENIAL = `{
  "error": {
    "code": -32090,
    "message": "Palisec denied the operation",
    "data": {
      "reason_code": "PS_BUDGET_001",
      "request_id": "ps_req_example",
      "retryable": true,
      "transaction_hash": null
    }
  }
}`;

export default function ErrorsPage() {
  const codes = Object.keys(REASON_CODES) as ReasonCode[];
  return (
    <DocArticle
      title="Errors and operations"
      lede="Every decision carries a stable, machine-readable reason code. Codes are append-only and never renumbered."
      maturity="local"
    >
      <h2 id="codes">Reason codes</h2>
      <table>
        <thead><tr><th>Code</th><th>Meaning</th><th>Retry</th></tr></thead>
        <tbody>
          {codes.map((c) => (
            <tr key={c} id={c}>
              <td className="font-mono text-[12px] text-fg">{c}</td>
              <td>{REASON_CODES[c]}</td>
              <td className="font-mono text-[11px] text-muted">{RETRYABLE[c] ? "after condition clears" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-muted">
        <code>PS_REQUEST_001</code> extends the original specification table: request schema failures need a code distinct from
        policy failures.
      </p>

      <h2 id="api-errors">API errors outside policy decisions</h2>
      <table>
        <thead><tr><th>Code</th><th>When</th><th>Retry</th></tr></thead>
        <tbody>
          <tr><td className="font-mono text-[12px] text-fg">PS_AUTH_001</td><td>Missing or invalid credentials, or a scope the key does not hold.</td><td className="font-mono text-[11px] text-muted">no</td></tr>
          <tr><td className="font-mono text-[12px] text-fg">PS_AUTH_002</td><td>Smart accounts: the operation is not allowed or approved, or its authorization expired.</td><td className="font-mono text-[11px] text-muted">no</td></tr>
          <tr><td className="font-mono text-[12px] text-fg">PS_AUTH_003</td><td>Smart accounts: the signature is not from an owner of the account (or is PALISEC&apos;s own).</td><td className="font-mono text-[11px] text-muted">no</td></tr>
          <tr><td className="font-mono text-[12px] text-fg">PS_ACCOUNT_001</td><td>Smart accounts: the agent&apos;s account is not a Safe with the 4337 module, PALISEC as an owner and a threshold of 2.</td><td className="font-mono text-[11px] text-muted">no</td></tr>
          <tr><td className="font-mono text-[12px] text-fg">PS_CHAIN_001</td><td>The chain RPC or the bundler is unavailable, or the bundler refused the operation (its message is included).</td><td className="font-mono text-[11px] text-muted">after condition clears</td></tr>
          <tr><td className="font-mono text-[12px] text-fg">PS_REPLAY_001</td><td>A request ID reused, or an operation already submitted.</td><td className="font-mono text-[11px] text-muted">no</td></tr>
          <tr><td className="font-mono text-[12px] text-fg">PS_RATE_001</td><td>Too many requests from one address in a minute.</td><td className="font-mono text-[11px] text-muted">after a minute</td></tr>
        </tbody>
      </table>

      <h2 id="denied-is-not-reverted">A denial is not a revert</h2>
      <p>
        When the gateway denies an operation before broadcast, it returns a structured JSON-RPC error. No transaction exists, so
        there is no transaction hash and no revert. An EVM revert happens only when an executed transaction reverts on chain.
      </p>
      <CodeBlock code={DENIAL} title="JSON-RPC denial · proposed error shape" pseudo />

      <h2 id="retries">Retry semantics</h2>
      <ul>
        <li>Retry only operations created with an idempotency key. A retry with the same key returns the original result.</li>
        <li>Use bounded exponential backoff. Never retry a financial action without proof that it cannot execute twice.</li>
        <li><code>PS_LOOP_001</code> is not retryable: change the intent, or wait out the cooldown with a new request.</li>
      </ul>

      <h2 id="states">Operation states</h2>
      <p>Approval, signing, submission, inclusion and success are separate states, never conflated.</p>
      <table>
        <thead><tr><th>State</th><th>Meaning</th></tr></thead>
        <tbody>
          {STATES.map(([s, m]) => (
            <tr key={s}><td className="font-mono text-[12px] text-fg">{s}</td><td>{m}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="failures">Failure behaviour</h2>
      <table>
        <thead><tr><th>Failure</th><th>Required behaviour</th></tr></thead>
        <tbody>
          {FAILURES.map(([f, b]) => (
            <tr key={f}><td className="text-fg">{f}</td><td><Codes text={b} /></td></tr>
          ))}
        </tbody>
      </table>
      <Note title="Fail closed">
        Failed, ambiguous, timed-out or unverifiable authorization always results in no signature. Availability problems never
        turn into permissive decisions.
      </Note>

      <h2 id="recovery">Recovery procedures</h2>
      <ol>
        <li><strong>Denied (terminal).</strong> Read <code>reason_code</code> and <code>message</code>. Change the intent or the policy;
          never retry the same request. Nothing was signed, so there is nothing to reconcile.</li>
        <li><strong>Retryable denial.</strong> If <code>retryable</code> is true (budget, rate, fee, state, chain), wait for the condition to
          clear and resubmit with the same idempotency key. A repeat with the same key returns the original result.</li>
        <li><strong>Pending approval.</strong> Poll the approval or subscribe to its status. If it expires or the policy version changes, the
          pending authorization is invalidated and its reservation released; submit a new request.</li>
        <li><strong>Submitted, outcome unknown.</strong> Do not resubmit. Query the operation until it reaches a final state; the reservation
          is held until the receipt is reconciled, so a retry cannot create a second execution.</li>
        <li><strong>Emergency stop.</strong> New operations are denied with <code>PS_PAUSED_001</code>. Resume only after the stop is
          released by an authorized operator and health checks pass.</li>
      </ol>

      <h2 id="rpc-outages">RPC and bundler outages</h2>
      <p>
        When the RPC endpoint, fee estimator or bundler is unavailable, new authorizations fail closed (<code>PS_FEE_001</code>,{" "}
        <code>PS_CHAIN_001</code>). Already-submitted operations keep their state and reservation until a receipt is verified; an
        unverified or disputed receipt never finalizes spend. Retries use bounded exponential backoff and the original idempotency key.
      </p>

      <h2 id="debugging">Debugging</h2>
      <ul>
        <li>Every response carries a <code>request_id</code>. Use it to find the audit record, which lists every check in evaluation
          order with its result and detail.</li>
        <li>Reproduce a decision locally: the reference evaluator is deterministic, so the same policy, request and state give the same
          result. The <Link href="/#workbench">workbench</Link> runs it in the browser, and the hosted API runs it on the server.</li>
        <li>Check the policy version in the response against the version you expect to be active. Approvals and authorizations are bound
          to the version they were evaluated under.</li>
        <li><code>transaction_hash</code> is null whenever nothing was broadcast. A non-null hash with a failed status is an EVM revert,
          which is different from a denial.</li>
      </ul>
    </DocArticle>
  );
}

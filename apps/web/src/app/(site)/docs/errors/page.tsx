import type { Metadata } from "next";
import { REASON_CODES, RETRYABLE, type ReasonCode } from "@palisec/policy-schema";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Errors and operations",
  description: "Stable Palisec reason codes, retry semantics, operation states and failure behaviour.",
  alternates: { canonical: "/docs/errors" },
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
  ["State store unavailable", "Do not approve on stale counters (RW_STATE_001)."],
  ["Enclave unavailable", "Typed unavailable error. Never fall back to an unprotected signer."],
  ["Fee estimation unavailable", "Deny or require review per policy (RW_FEE_001)."],
  ["Bundler unavailable", "Preserve operation state and reservation until reconciled (RW_CHAIN_001)."],
  ["Telemetry unavailable", "Buffer bounded, redacted events. Decisions are unaffected."],
  ["RPC disagreement", "Do not finalize on an unverified receipt."],
  ["Approval expires", "Invalidate the pending authorization."],
  ["Duplicate request", "Return the existing idempotent result, or RW_REPLAY_001."],
];

const DENIAL = `{
  "error": {
    "code": -32090,
    "message": "Palisec denied the operation",
    "data": {
      "reason_code": "RW_BUDGET_001",
      "request_id": "rw_req_example",
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
        <code>RW_REQUEST_001</code> extends the original specification table: request schema failures need a code distinct from
        policy failures.
      </p>

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
        <li><code>RW_LOOP_001</code> is not retryable: change the intent, or wait out the cooldown with a new request.</li>
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
            <tr key={f}><td className="text-fg">{f}</td><td>{b}</td></tr>
          ))}
        </tbody>
      </table>
      <Note title="Fail closed">
        Failed, ambiguous, timed-out or unverifiable authorization always results in no signature. Availability problems never
        turn into permissive decisions.
      </Note>
    </DocArticle>
  );
}

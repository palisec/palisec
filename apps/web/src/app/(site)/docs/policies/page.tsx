import type { Metadata } from "next";
import Link from "next/link";
import { EXAMPLE_POLICY } from "@palisec/policy-schema";
import schema from "@palisec/policy-schema/policy.schema.json";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Policy schema",
  description: "The canonical Palisec policy schema 1.0: fields, units, precedence, evaluation order and validation.",
  alternates: { canonical: "/docs/policies" },
};

type Node = {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  $ref?: string;
  description?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, Node>;
  items?: Node;
};
const DEFS = (schema as { $defs: Record<string, Node> }).$defs;

/** Flattens the JSON Schema into reference rows, so this table cannot drift from the schema. */
function rows(node: Node, path: string, required: boolean, out: { path: string; type: string; rule: string; desc: string; required: boolean }[] = []) {
  const ref = node.$ref ? DEFS[node.$ref.split("/").pop()!] : undefined;
  const n = { ...ref, ...node };
  if (path) {
    const type =
      n.const !== undefined ? `const ${JSON.stringify(n.const)}` :
      n.enum ? n.enum.map((e) => JSON.stringify(e)).join(" | ") :
      node.$ref ? node.$ref.split("/").pop()! :
      n.type === "array" ? `${n.items?.$ref?.split("/").pop() ?? n.items?.type ?? "item"}[]` :
      n.type ?? "";
    const rule = [
      n.minimum !== undefined && n.maximum !== undefined ? `${n.minimum}…${n.maximum}` : "",
      n.maxItems !== undefined ? `≤ ${n.maxItems} items` : "",
      n.pattern && !node.$ref ? `/${n.pattern}/` : "",
    ].filter(Boolean).join(" · ");
    out.push({ path, type, rule, desc: n.description ?? ref?.description ?? "", required });
  }
  if (n.properties) for (const [k, v] of Object.entries(n.properties)) rows(v, path ? `${path}.${k}` : k, n.required?.includes(k) ?? false, out);
  if (n.type === "array" && n.items?.properties) rows(n.items, `${path}[]`, true, out);
  return out;
}

const ORDER = [
  ["Policy", "A valid, active policy exists for the account.", "RW_POLICY_001"],
  ["Request schema", "Fields are well-formed and within size bounds.", "RW_REQUEST_001"],
  ["Replay", "request_id is new and the deadline has not passed.", "RW_REPLAY_001"],
  ["Emergency stop and agent", "No global stop; the agent is not paused.", "RW_PAUSED_001"],
  ["Chain and account", "Chain ID and sender match the policy.", "RW_TARGET_001"],
  ["Explicit deny", "Target is not denylisted.", "RW_POLICY_002"],
  ["Target", "Target is allowlisted (and code-verified if required).", "RW_TARGET_001"],
  ["Method", "Selector is allowlisted, or routed to review.", "RW_METHOD_001 / RW_HUMAN_001"],
  ["Value", "Native value ≤ per-transaction limit.", "RW_BUDGET_001"],
  ["Fee", "A bounded fee estimate exists and is within the gas limit.", "RW_FEE_001 / RW_BUDGET_001"],
  ["Price", "A price exists and is fresher than max_price_age_seconds.", "RW_STATE_001"],
  ["Budget", "Window usage + this request ≤ hourly budget; reserve atomically.", "RW_BUDGET_001"],
  ["Pending", "Open reservations < max_pending_operations.", "RW_RATE_001"],
  ["Loop", "No identical calldata or equivalent intent within cooldowns.", "RW_LOOP_001"],
  ["Human threshold", "Exposure below the approval threshold, else review.", "RW_HUMAN_001"],
];

export default function PoliciesPage() {
  const fieldRows = rows(schema as Node, "", true);
  return (
    <DocArticle
      title="Policy schema"
      lede="One canonical, versioned document defines what an agent may do. The browser workbench validates against it today; the Rust engine and the SDKs will be generated from it."
      maturity="local"
    >
      <h2 id="document">Representative document</h2>
      <p>
        Addresses and limits are illustrative, not deployments or recommended production values. Integers that can exceed
        2<sup>53</sup> are decimal strings. Floats are rejected.
      </p>
      <CodeBlock code={JSON.stringify(EXAMPLE_POLICY, null, 2)} title="policy_trading_001.json" />
      <p>
        The full JSON Schema is in <code>packages/policy-schema/policy.schema.json</code>. Unknown fields are rejected so that a
        typo can never silently disable a rule.
      </p>

      <h2 id="fields">Field reference</h2>
      <div className="overflow-x-auto">
        <table className="min-w-[640px]">
          <thead>
            <tr><th>Field</th><th>Type</th><th>Constraint</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {fieldRows.map((r) => (
              <tr key={r.path}>
                <td className="font-mono text-[12px] text-fg">{r.path}{!r.required && <span className="text-dim">?</span>}</td>
                <td className="font-mono text-[12px] text-soft">{r.type}</td>
                <td className="font-mono text-[11px] text-muted">{r.rule}</td>
                <td className="text-[13px] text-muted">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="units">Units</h2>
      <ul>
        <li><strong>Native value and fees</strong> are integer wei.</li>
        <li><strong>USD amounts</strong> are integer micros (1 USD = 1,000,000). Conversion rounds up, so limits are never under-counted.</li>
        <li><strong>USD enforcement needs a fresh price.</strong> A missing price, or one older than <code>max_price_age_seconds</code>, fails closed with <code>RW_STATE_001</code>.</li>
        <li><strong>Exposure</strong> is native value plus estimated fee. Token-denominated allocations are specified but not yet in schema 1.0.</li>
      </ul>

      <h2 id="precedence">Precedence</h2>
      <ol>
        <li>An active global emergency stop denies all new protected executions.</li>
        <li>An explicit deny overrides any allow.</li>
        <li>A required human approval cannot be overridden by an ordinary allow rule.</li>
        <li>A missing or invalid policy is never treated as an empty, allow-all policy.</li>
        <li>An unknown method is denied or routed to review, according to <code>require_for_unknown_methods</code>.</li>
        <li>An unavailable or unbounded fee estimate is never treated as zero.</li>
        <li>Activating a new policy version invalidates pending approvals bound to the previous one.</li>
      </ol>

      <h2 id="contracts">Evaluation order</h2>
      <p>
        Checks run in this fixed order and stop at the first failure. The SDK never decides which checks are authoritative.
        Read-only checks may be reordered for performance; budget reservation and replay protection stay atomic.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[600px]">
          <thead><tr><th>#</th><th>Check</th><th>Passes when</th><th>Fails with</th></tr></thead>
          <tbody>
            {ORDER.map(([name, rule, code], i) => (
              <tr key={name}>
                <td className="font-mono text-[12px] text-dim">{String(i + 1).padStart(2, "0")}</td>
                <td className="text-fg">{name}</td>
                <td className="text-[13px] text-muted">{rule}</td>
                <td className="font-mono text-[11px] text-soft">{code}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        After a local ALLOW, the production path also simulates execution, binds the authorization to the operation hash, chain,
        policy version and expiry, signs inside the enclave, and submits to the bundler. None of these run in the simulator.
      </p>

      <h2 id="budgets">Budgets and reservations</h2>
      <p>
        Every allowed or pending operation creates a reservation with a unique ID, amount, policy version, expiry and lifecycle
        state: <code>reserved</code>, <code>pending_approval</code>, <code>released</code> or <code>finalized</code>. The hourly
        budget counts every non-released reservation created in the trailing 3,600 seconds.
      </p>
      <Note kind="warning" title="Concurrency">
        In production, reservations are written to a serialized, authoritative ledger keyed by account, agent and window.
        If five requests race for the last slot, exactly one reserves it. In-memory counters and analytics aggregates are never
        used for this decision.
      </Note>

      <h2 id="validation">Validation errors</h2>
      <p>
        Validation returns a list of <code>{"{ path, message }"}</code> pairs using JSONPath-style paths, for example{" "}
        <code>$.limits.max_transaction_value_wei: must be a non-negative integer string</code>. A policy with any validation error
        cannot be activated. Try it: edit a limit in the <Link href="/#workbench">workbench</Link> to an invalid value.
      </p>
    </DocArticle>
  );
}

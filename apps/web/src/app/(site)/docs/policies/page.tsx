import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { EXAMPLE_POLICY } from "@palisec/policy-schema";
import schema from "@palisec/policy-schema/policy.schema.json";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Codes, Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Policy schema",
  description: "The canonical Palisec policy schema (versions 1.0 to 1.5): fields, units, precedence, evaluation order and validation.",
  alternates: { canonical: "/docs/policies" }, openGraph: pageOpenGraph("/docs/policies"),
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
  ["Policy", "A valid, active policy exists for the account.", "PS_POLICY_001"],
  ["Request schema", "Fields are well-formed and within size bounds.", "PS_REQUEST_001"],
  ["Replay", "request_id is new and the deadline has not passed.", "PS_REPLAY_001"],
  ["Emergency stop and agent", "No global stop; the agent is not paused.", "PS_PAUSED_001"],
  ["Account stop", "For accounts on the policy registry: no stop held by the account, or a withdrawal to an exit address.", "PS_PAUSED_001 / PS_STATE_001"],
  ["Chain and account", "Chain ID and sender match the policy.", "PS_TARGET_001"],
  ["Explicit deny", "Target is not denylisted.", "PS_POLICY_002"],
  ["Target", "Target is allowlisted (and code-verified if required).", "PS_TARGET_001"],
  ["Method", "Selector is allowlisted, or routed to review.", "PS_METHOD_001 / PS_HUMAN_001"],
  ["Value", "Native value ≤ per-transaction limit.", "PS_BUDGET_001"],
  ["Fee", "A bounded fee estimate exists and is within the gas limit.", "PS_FEE_001 / PS_BUDGET_001"],
  ["Price", "A price exists and is fresher than max_price_age_seconds.", "PS_STATE_001"],
  ["Token spend", "With token_spend on: tokens out and open allowances priced in USD; exposure ≤ max_transaction_usd_micros.", "PS_BUDGET_001 / PS_PRICE_001 / PS_SIM_002"],
  ["Budget", "Window usage + this request's exposure ≤ hourly budget; reserve atomically.", "PS_BUDGET_001"],
  ["Pending", "Open reservations < max_pending_operations.", "PS_RATE_001"],
  ["Loop", "No identical calldata or equivalent intent within cooldowns.", "PS_LOOP_001"],
  ["Human threshold", "Exposure below the approval threshold, else review.", "PS_HUMAN_001"],
];

export default function PoliciesPage() {
  const fieldRows = rows(schema as Node, "", true);
  return (
    <DocArticle
      title="Policy schema"
      lede="One canonical, versioned document defines what an agent may do. The browser workbench, the API, the Rust engine and the SDKs all validate against it."
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
        <table className="min-w-[47.5rem] table-fixed [&_th]:whitespace-nowrap">
          <colgroup><col className="w-[30%]" /><col className="w-[12%]" /><col className="w-[26%]" /><col /></colgroup>
          <thead>
            <tr><th>Field</th><th>Type</th><th>Constraint</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {fieldRows.map((r) => (
              <tr key={r.path}>
                <td className="font-mono text-[0.75rem] text-fg">{r.path.split(/(?<=[._])/).map((seg, k) => <span key={k}>{seg}<wbr /></span>)}{!r.required && <span className="text-dim">?</span>}</td>
                <td className="font-mono text-[0.75rem] text-soft">{r.type}</td>
                <td className="whitespace-pre-wrap break-words font-mono text-[0.6875rem] text-muted [overflow-wrap:anywhere]">{r.rule}</td>
                <td className="text-[0.8125rem] text-muted"><Codes text={r.desc} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="units">Units</h2>
      <ul>
        <li><strong>Native value and fees</strong> are integer wei.</li>
        <li><strong>USD amounts</strong> are integer micros (1 USD = 1,000,000). Conversion rounds up, so limits are never under-counted.</li>
        <li><strong>USD enforcement needs a fresh price.</strong> A missing price, or one older than <code>max_price_age_seconds</code>, fails closed with <code>PS_STATE_001</code>.</li>
        <li><strong>Exposure</strong> is what the per-transaction limits, the hourly budget and the approval threshold count. Without{" "}
          <code>token_spend</code> it is native value plus estimated fee only, so a swap from USDG or a stock token counts as its fee.
          With <code>token_spend</code> on (schema 1.5), it is native value plus fee plus the USD value of every token the transaction
          spends and every allowance it leaves open. See <a href="#token-spend">Token spend</a>.</li>
      </ul>

      <h2 id="token-spend">Token spend (schema 1.5)</h2>
      <p>
        With <code>token_spend.enabled</code>, the spending limits count tokens, not only ETH. Before each decision Palisec simulates the
        exact call (the same simulation asset safety uses) and prices what it spends with the Chainlink feeds on Robinhood Chain.
      </p>
      <ul>
        <li><strong>What counts:</strong> ETH sent, the fee, every token that leaves the account (through a router, a multicall or any other
          contract), and every allowance the call grants that is still open when it ends, at its full amount. An approval pulled in full
          inside the same call counts once, as the tokens that left. An approval and a later swap that uses it are each counted.</li>
        <li><strong>Where it counts:</strong> <code>max_transaction_usd_micros</code> per transaction, the hourly budget, and the human
          approval threshold. Over a limit: <code>PS_BUDGET_001</code>; at the threshold: <code>PS_HUMAN_001</code>.</li>
        <li><strong>Prices:</strong> ETH, WETH, USDG and the listed stock tokens, from Chainlink, with the loss limit&apos;s checks (fresh
          within the feed&apos;s heartbeat, stock tokens up to <code>max_closed_market_price_age_seconds</code> while markets are closed, no
          oracle pause, USDG within 2% of $1). A token without a reliable price is never counted as $0: <code>PS_PRICE_001</code>, denied
          or held for a human per <code>on_price_unavailable</code>.</li>
        <li><strong>Unknown outflows:</strong> no simulation, or one older than 60 seconds, means the outflows are unknown and the request is
          denied (<code>PS_SIM_002</code>), whatever <code>on_price_unavailable</code> says. An unlimited allowance cannot fit a limit and is
          denied (<code>PS_BUDGET_001</code>).</li>
        <li><strong>A swap&apos;s output returns to the account:</strong> with <code>require_output_to_account</code>, a contract call that
          spends tokens and brings nothing back is denied (<code>PS_ASSET_003</code>).</li>
        <li><strong>Existing policies:</strong> the rule is opt-in. Adding it, or lowering its cap, is a tightening and applies at once;
          raising the cap, switching it off or holding missing prices for review is a loosening and waits the delay. Allowances granted
          before the rule was on are not counted; revoke them when you turn it on. Unlocked limits from a Zolva record do not raise{" "}
          <code>max_transaction_usd_micros</code>.</li>
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
        <table className="min-w-[37.5rem]">
          <thead><tr><th>#</th><th>Check</th><th>Passes when</th><th>Fails with</th></tr></thead>
          <tbody>
            {ORDER.map(([name, rule, code], i) => (
              <tr key={name}>
                <td className="font-mono text-[0.75rem] text-dim">{String(i + 1).padStart(2, "0")}</td>
                <td className="text-fg">{name}</td>
                <td className="text-[0.8125rem] text-muted"><Codes text={rule} /></td>
                <td className="font-mono text-[0.6875rem] text-soft">{code}</td>
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

      <h2 id="asset-safety">Asset safety (schema 1.1)</h2>
      <p>
        Before Palisec allows (and co-signs) a contract call, it simulates the exact operation from the account on current
        Robinhood Chain state. The simulation records every token and ETH balance change, every approval, and whether the
        call reverts. When the account receives a token, a second step sends it back to the pool it came from, which is the
        first leg of any sell: a token that blocks that transfer is a likely honeypot, and a shortfall is a transfer tax. The
        result goes to both policy engines as an input, like the price and the fee, and the rules below decide.
      </p>
      <ul>
        <li><code>max_transfer_tax_bps</code> (default 500, 5%): a higher buy or sell tax is <code>PS_ASSET_002</code>.</li>
        <li><code>require_sell_simulation</code> (default on): a received token whose sell leg reverts is <code>PS_ASSET_001</code>.</li>
        <li><code>max_slippage_bps</code> (default 300): receiving less than the declared quote minus this is <code>PS_ASSET_003</code>.</li>
        <li><code>block_unlimited_approvals</code> (default on): an approval to a contract that is not on the allowlist must be for the exact declared amount, and never unlimited, or it is <code>PS_APPROVAL_001</code>.</li>
        <li><code>on_simulation_unavailable</code> (default <code>deny</code>, or <code>review</code>): with no simulation, or one older than <code>max_simulation_age_seconds</code> (default 10), the request is denied or held for a person, never allowed (<code>PS_SIM_001</code>).</li>
      </ul>
      <p>
        Agents declare what an operation spends and receives with the optional <code>asset_intent</code> field (a list of
        token and amount pairs under <code>spend</code> and <code>receive</code>, with <code>0xEeee…EEeE</code> for ETH). The
        ETH value sent and the amount of a plain ERC-20 <code>transfer</code> count as declared. Tokens leaving the account
        beyond what was declared are <code>PS_ASSET_003</code>. New policies have asset safety on; policies created before it
        keep it off until an owner adds the section. Each decision&apos;s <code>asset</code> check shows the simulated block,
        the tax, the round-trip loss (when the pool quotes it) and the approvals.
      </p>

      <h2 id="upoch-recovery">Recoverable on Upoch (schema 1.2)</h2>
      <p>
        An optional rule that an agent must be recoverable on <a href="https://upoch.tech">Upoch</a>, which keeps verifiable
        checkpoints of an agent&apos;s state on Robinhood Chain. Off by default; add the <code>upoch_recovery</code> section (and{" "}
        <code>schema_version</code> &quot;1.2&quot;) and set the agent&apos;s Upoch workflow on its page. Before each decision
        Palisec reads the workflow from Upoch&apos;s contract (read-only) and both engines apply:
      </p>
      <ul>
        <li><code>require_upoch_recoverable</code>: the workflow must be set, active, linked to the account (its owner or a guardian is an owner of the account) and have a checkpoint, or the request is <code>PS_RECOVERY_001</code>.</li>
        <li><code>max_checkpoint_age_seconds</code> (60 to 31,536,000; e.g. 604800 for 7 days): an older newest checkpoint is <code>PS_RECOVERY_002</code>.</li>
        <li><code>require_guardian</code>: the workflow must have at least one guardian, or <code>PS_RECOVERY_001</code>.</li>
        <li><code>on_unavailable</code> (<code>deny</code> or <code>review</code>): Upoch cannot be read, so <code>PS_RECOVERY_003</code> denies or holds for a person, never allows.</li>
      </ul>
      <p>Turning the rule off, allowing older checkpoints or switching to review are loosening changes, so they wait out the delay below.</p>

      <h2 id="loss-limit">Loss limit (schema 1.3)</h2>
      <p>
        An optional <code>loss_limit</code> section (and <code>schema_version</code> &quot;1.3&quot;) caps how much the account may
        lose over a rolling window. Once reached, Palisec stops co-signing anything that adds risk (<code>PS_LOSS_001</code>,{" "}
        <code>PS_LOSS_002</code>); exits stay open, and only the owner can reset it after the loosening delay. Fields, measurement
        and resets: <Link href="/docs/loss-limits">Loss limits</Link>.
      </p>

      <h2 id="proven-record">Bigger limits once proven on Zolva (schema 1.4)</h2>
      <p>
        An optional <code>proven_record</code> section (and <code>schema_version</code> &quot;1.4&quot;) gives an agent bigger
        limits once it has a verified Zolva record (paper trading): <code>unlocked_limits</code> replace{" "}
        <code>limits.max_transaction_value_wei</code> and <code>limits.hourly_budget_usd_micros</code>, each at least the
        policy&apos;s own. They apply only with the Zolva link verified from both sides, Zolva&apos;s replay check
        &quot;match&quot;, at least <code>min_verified_hours</code> verified, a record no older than{" "}
        <code>max_record_age_seconds</code>, and an unlock that has waited out the loosening delay. Anything missing, stale or
        unclear keeps the policy&apos;s own limits. Details: <Link href="/docs/zolva#proven">Zolva</Link>.
      </p>

      <h2 id="loosening-delay">Loosening delay</h2>
      <p>
        A change that makes the rules weaker waits before it takes effect; a change that makes them stronger applies at once.
        Loosening includes a higher limit, budget or approval threshold, a new allowlisted contract or function, a removed deny
        rule, a shorter cooldown, unknown methods moving from deny to review, weaker asset-safety settings, and anything that
        cannot be classified safely. If a new version loosens anything, the whole version waits as{" "}
        <code>pending_activation</code> until <code>effective_at</code>, and the current version keeps deciding every request
        until then. The same applies to resuming a paused agent, moving an agent to a looser policy, adding a second agent on an
        account that is already protected, lifting the emergency stop, and shortening a delay.
      </p>
      <p>
        The delay is 60 minutes by default (15 minutes to 72 hours, set by an owner); lifting the emergency stop waits 15
        minutes by default. Engaging the stop is always instant and cancels a pending lift. Any owner, admin or operator can
        cancel a pending change at once, from the banner in the console or through the API. When a change enters the delay,
        Palisec sends the <code>policy.loosening_pending</code> webhook with the diff and <code>effective_at</code>, raises a
        security event, and shows a countdown in the console; it also sends <code>policy.loosening_applied</code> and{" "}
        <code>policy.loosening_cancelled</code>. Every step is in the audit log with who did it and the exact diff.
      </p>

      <h2 id="migration">Version migration</h2>
      <p>
        <code>schema_version</code> names the document format; <code>version</code> numbers each activated policy. They move
        independently.
      </p>
      <ul>
        <li><strong>Policy versions.</strong> Every activation creates a new integer version. The previous version is kept and can be loaded
          back into a draft; nothing is edited in place. Pending approvals evaluated under an older version are invalidated on activation.</li>
        <li><strong>Schema versions.</strong> A schema change ships with a new <code>schema_version</code>. Unknown fields are rejected, so
          a document written for a newer schema fails validation on an older evaluator instead of being half-applied.</li>
        <li><strong>Migrating a document.</strong> Convert the old document, validate it against the new schema, run your test transactions
          against it as a draft, compare the decisions with the active version, then activate it explicitly.</li>
      </ul>
      <p>
        Schema 1.1 adds the optional asset_safety section and needs no migration: 1.0 documents stay valid and keep asset safety off.
        Schema 1.5 adds the optional token_spend section the same way: a document moved to 1.5 without it decides exactly as before. Each future schema version will list its changes and a conversion
        table in the <Link href="/changelog">changelog</Link>.
      </p>

      <h2 id="validation">Validation errors</h2>
      <p>
        Validation returns a list of <code>{"{ path, message }"}</code> pairs using JSONPath-style paths, for example{" "}
        <code>$.limits.max_transaction_value_wei: must be a non-negative integer string</code>. A policy with any validation error
        cannot be activated. Try it: edit a limit in the <Link href="/#workbench">workbench</Link> to an invalid value.
      </p>
    </DocArticle>
  );
}

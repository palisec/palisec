import { VERSIONS } from "@/lib/versions";
import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Sign in, write a policy, register an agent and authorize your first operation on Robinhood Chain, or evaluate policies locally.",
  alternates: { canonical: "/docs/quickstart" }, openGraph: pageOpenGraph("/docs/quickstart"),
};

const LOCAL = `# the evaluator ships inside the TypeScript SDK, as @palisec/sdk/policy
npm install @palisec/sdk`;

const EVALUATE = `import {
  EMPTY_STATE, EXAMPLE_ENV, EXAMPLE_POLICY, SCENARIOS, evaluate,
} from "@palisec/sdk/policy";

const swap = SCENARIOS.find((s) => s.id === "swap")!;

const result = evaluate(
  EXAMPLE_POLICY,
  { ...swap.intent, request_id: "req_001", deadline: EXAMPLE_ENV.now + 120 },
  EMPTY_STATE,
  EXAMPLE_ENV,
);

console.log(result.decision, result.reason_code);  // "ALLOW" null
// Keep result.next_state to evaluate the next request against the new ledger.`;

const AGENT = `// Node 22+, no dependencies. PALISEC_API_KEY comes from Console → Agents → Create key.
const API = "https://palisec.tech/api/v1";

async function authorize(tx: { to: string; value: bigint; data: string; gas: number }) {
  const requestId = crypto.randomUUID();          // unique per intended transaction
  const res = await fetch(\`\${API}/operations\`, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${process.env.PALISEC_API_KEY}\`,
      "content-type": "application/json",
      "idempotency-key": requestId,               // a retry returns the same decision
    },
    body: JSON.stringify({
      request_id: requestId,
      chain_id: 4663,                             // Robinhood Chain (46630 for testnet)
      to: tx.to,
      value_wei: tx.value.toString(),             // integers as strings, never floats
      data: tx.data,
      gas_limit: tx.gas,                          // the fee bound is gas_limit × gas price
      deadline: Math.floor(Date.now() / 1000) + 120,
    }),
  });
  const op = await res.json();
  if (!res.ok) throw new Error(\`\${op.error.code}: \${op.error.message}\`);
  return op; // { decision, reason_code, state, authorization_id, expires_at, checks, ... }
}

const op = await authorize({ to: TOKEN, value: 0n, data: transferCalldata, gas: 90_000 });
if (op.decision === "ALLOW") {
  // Send the transaction yourself, before op.expires_at.
} else if (op.decision === "REQUIRES_HUMAN_SIGNATURE") {
  // Poll GET /operations/{op.operation_id} until state is "approved" (then send) or "rejected".
} else {
  console.warn("Denied:", op.reason_code, op.message); // never send a denied transaction
}`;

const DRY_RUN = `curl -s https://palisec.tech/api/v1/authorizations/evaluate \\
  -H "authorization: Bearer $PALISEC_API_KEY" -H "content-type: application/json" \\
  -d '{"request_id":"try-1","chain_id":46630,"to":"0x…","value_wei":"0","data":"0x",
       "gas_limit":21000,"deadline":'$(($(date +%s)+60))'}'`;

export default function Quickstart() {
  return (
    <DocArticle
      title="Quickstart"
      lede="Part one runs on the hosted service today: sign in, write a policy, register an agent and ask Palisec before every transaction. Part two evaluates policies locally with the reference evaluator."
      maturity="service"
    >
      <h2 id="hosted">1 · Your first authorized operation</h2>
      <Note kind="warning" title="What Palisec enforces">
        Palisec records each decision and enforces budgets, cooldowns, replay protection and approvals for agents that ask it. An agent
        that sends from a plain key is enforced only in its own process; for on-chain enforcement, give it a{" "}
        <Link href="/docs/account-abstraction">Palisec smart account</Link>. Try it on testnet first (chain 46630, switch in the console&apos;s top bar), then use mainnet (4663) with a Palisec smart account and a tested policy. Mainnet · real funds · start with small balances.
      </Note>
      <ol>
        <li><strong>Sign in.</strong> Open <Link href="/login">/login</Link> and sign the message with your wallet. Your first sign-in creates an organization with you as owner.</li>
        <li><strong>Create a policy.</strong> In <Link href="/console/policies">Console → Policies</Link>, enter the smart account your agent acts for. The draft starts strict: tiny limits and nothing allowlisted.</li>
        <li><strong>Allow what the agent needs.</strong> Add each contract and function selector, set the hourly budget and the approval threshold, then save. The editor validates against schema {VERSIONS.schema} as you type.</li>
        <li><strong>Activate.</strong> Review the changes and activate. This creates an immutable version 1 and an audit event.</li>
        <li><strong>Register the agent and create a key.</strong> In <Link href="/console/agents">Console → Agents</Link>, bind the agent to the policy, then create an API key. Copy it: it is shown once.</li>
        <li><strong>Ask before every transaction.</strong> Your agent calls <code>POST /v1/operations</code> and only sends on <code>ALLOW</code>.</li>
      </ol>
      <CodeBlock code={AGENT} title="agent.ts" />
      <p>Try a request without reserving anything: the dry run returns the same decision and evaluation sequence, and consumes no request ID or budget.</p>
      <CodeBlock code={DRY_RUN} title="terminal" />
      <ul>
        <li><strong>Authorization is not execution.</strong> For an agent that sends from its own key, <code>transaction_hash</code> stays <code>null</code>: Palisec did not broadcast anything. Agents with a <Link href="/docs/account-abstraction">Palisec smart account</Link> execute through Palisec, and the hash is recorded.</li>
        <li><strong>Budget is held until it expires.</strong> An allowed amount counts against the hourly budget even if you never send, because nobody can prove you did not. Only a console operator can release it.</li>
        <li><strong>Approvals bind the exact operation.</strong> An approver signs the request hash, target, value, calldata hash, policy version and expiry. Changing any of them needs a new approval.</li>
      </ul>
      <p>
        Using TypeScript? The <Link href="/docs/sdk/typescript">SDK</Link> does all of this in one call:{" "}
        <code>palisec.sendTransaction(wallet, intent)</code> authorizes and sends with viem or ethers only on ALLOW. Python agents use the{" "}
        <Link href="/docs/sdk/python">Python SDK</Link>, with the same semantics. Every endpoint, field and status code
        is in the <Link href="/docs/api">API reference</Link>.
      </p>

      <h2 id="local">2 · Evaluate locally</h2>
      <p>Requires Node 18 or later. The same evaluator runs in the API next to the Rust engine.</p>
      <CodeBlock code={LOCAL} title="terminal" />
      <p>Evaluate an intent from TypeScript:</p>
      <CodeBlock code={EVALUATE} title="evaluate.ts" />
      <p>
        <code>evaluate()</code> is pure. It takes the time, fee estimate and price as inputs, never mutates state, and returns the
        next ledger snapshot. The same inputs always produce the same decision. Prefer a UI? The{" "}
        <Link href="/#workbench">workbench</Link> runs the same function in your browser.
      </p>

      <h2 id="next">Next</h2>
      <ul>
        <li><Link href="/docs/api">API reference</Link>: endpoints, authentication, idempotency and pagination.</li>
        <li><Link href="/docs/policies">Policy schema</Link>: every rule, unit and precedence rule.</li>
        <li><Link href="/docs/errors">Errors and operations</Link>: reason codes and retry semantics.</li>
        <li><Link href="/security">Security model</Link>: what the system does and does not protect.</li>
      </ul>
    </DocArticle>
  );
}

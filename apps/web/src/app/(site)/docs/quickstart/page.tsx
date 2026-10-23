import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Evaluate your first policy locally today, and see the protected-operation flow the hosted service will run.",
  alternates: { canonical: "/docs/quickstart" },
};

const LOCAL = `# from a checkout of the Palisec repository (access is currently private)
pnpm install
pnpm --filter @palisec/policy-schema test`;

const EVALUATE = `import {
  EMPTY_STATE, EXAMPLE_ENV, EXAMPLE_POLICY, SCENARIOS, evaluate,
} from "@palisec/policy-schema";

const swap = SCENARIOS.find((s) => s.id === "swap")!;

const result = evaluate(
  EXAMPLE_POLICY,
  { ...swap.intent, request_id: "req_001", deadline: EXAMPLE_ENV.now + 120 },
  EMPTY_STATE,
  EXAMPLE_ENV,
);

console.log(result.decision, result.reason_code);  // "ALLOW" null
// Keep result.next_state to evaluate the next request against the new ledger.`;

const PROTECTED = `import { palisec } from "@palisec/sdk";

const wall = palisec({ apiKey: process.env.PALISEC_API_KEY!, chainId: 46630 });

// 1. Register a constrained ERC-4337 account (testnet only).
const account = await wall.accounts.register({ address: SMART_ACCOUNT, chainId: 46630 });

// 2. Create and activate a policy.
const draft = await wall.policies.create(policyDocument);
await wall.policies.activate(draft.id);   // requires explicit confirmation

// 3. Submit an operation and inspect the decision.
const op = await wall.operations.create({ account: account.address, to, value, data,
  idempotencyKey: crypto.randomUUID() });

// 4. Verify the receipt. Authorization is not inclusion; inclusion is not success.
if (op.decision === "ALLOW") {
  const receipt = await wall.operations.waitForReceipt(op.operationId);
}`;

export default function Quickstart() {
  return (
    <DocArticle
      title="Quickstart"
      lede="Part one runs today: evaluate a policy locally with the reference evaluator. Part two shows the hosted protected-operation flow, which is specified but not yet deployed."
      maturity="local"
    >
      <h2 id="local">1 · Evaluate locally</h2>
      <p>Requires Node 22 and pnpm 10. The test suite covers each rule, precedence, replay, cooldowns and fail-closed behaviour.</p>
      <CodeBlock code={LOCAL} title="terminal" />
      <p>Evaluate an intent from TypeScript:</p>
      <CodeBlock code={EVALUATE} title="evaluate.ts" />
      <p>
        <code>evaluate()</code> is pure. It takes the time, fee estimate and price as inputs, never mutates state, and returns the
        next ledger snapshot. The same inputs always produce the same decision. Prefer a UI? The{" "}
        <Link href="/#workbench">workbench</Link> runs the same function in your browser.
      </p>

      <h2 id="protected">2 · First protected operation</h2>
      <Note kind="warning" title="Not yet runnable">
        The hosted API, the SDK and the smart-account module are not deployed. This is the intended flow; it will become runnable
        on testnet (chain 46630) first. Never use treasury funds with a pre-release system.
      </Note>
      <CodeBlock code={PROTECTED} title="agent.ts · proposed SDK" pseudo />
      <ol>
        <li><strong>Constrained account.</strong> The agent never holds an unrestricted key. The account only accepts operations carrying a valid Palisec authorization.</li>
        <li><strong>Explicit activation.</strong> Editing a policy never activates it. Activation creates a new version and an audit event.</li>
        <li><strong>Inspect the decision.</strong> DENY responses carry a reason code and no transaction hash.</li>
        <li><strong>Verify the receipt.</strong> The reservation is finalized with the actual fee only after the receipt is reconciled.</li>
      </ol>

      <h2 id="next">Next</h2>
      <ul>
        <li><Link href="/docs/policies">Policy schema</Link>: every rule, unit and precedence rule.</li>
        <li><Link href="/docs/errors">Errors and operations</Link>: reason codes and retry semantics.</li>
        <li><Link href="/security">Security model</Link>: what the system does and does not protect.</li>
      </ul>
    </DocArticle>
  );
}

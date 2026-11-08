import type { Metadata } from "next";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "TypeScript SDK",
  description: "The proposed @palisec/sdk interface: viem-first, typed decisions, typed errors and idempotent operations.",
  alternates: { canonical: "/docs/sdk/typescript" },
};

const TYPES = `type Decision =
  | { decision: "ALLOW"; operationId: string; authorizationId: string;
      policyVersion: number }
  | { decision: "REQUIRES_HUMAN_SIGNATURE"; operationId: string;
      approvalId: string; expiresAt: Date; reasonCode: "PS_HUMAN_001" }
  | { decision: "DENY"; reasonCode: ReasonCode; retryable: boolean;
      message: string; transactionHash: null };`;

const CONFIG = `import { palisec } from "@palisec/sdk";

const wall = palisec({
  apiKey: process.env.PALISEC_API_KEY!,  // server-side only; never in a browser bundle
  chainId: 4663,
  timeoutMs: 10_000,
  logger: console,                        // secrets are redacted before logging
});`;

const ERRORS = `try {
  await wall.operations.create(request);
} catch (err) {
  if (err instanceof PalisecError) {
    switch (err.code) {
      case "PS_STATE_001":   // retryable: authoritative state unavailable
      case "PS_CHAIN_001":   // retryable: bundler or RPC unavailable
        return retryWithSameIdempotencyKey(request);
      default:
        throw err;           // terminal
    }
  }
}`;

export default function TypeScriptSdk() {
  return (
    <DocArticle
      title="TypeScript SDK"
      lede="@palisec/sdk is a typed client for the canonical authorization protocol. It holds no security logic of its own: every decision is made server-side."
      maturity="specified"
      compat="Schema 1.0 · proposed interface · not published"
    >
      <Note kind="warning" title="Interface under design">
        The package is not published and these signatures may change. Snippets on this page are pseudocode until the SDK and API
        are tested together.
      </Note>

      <h2 id="install">Configuration</h2>
      <CodeBlock code={CONFIG} title="config.ts" pseudo />

      <h2 id="decisions">Decisions are a discriminated union</h2>
      <p>
        An ALLOW is an authorization, not a completed transaction. Submission, inclusion and execution are tracked separately
        through the operation status.
      </p>
      <CodeBlock code={TYPES} title="types.ts" pseudo />

      <h2 id="errors">Typed errors</h2>
      <p>Every reason code is exported as a string literal union. Retries reuse the original idempotency key.</p>
      <CodeBlock code={ERRORS} title="errors.ts" pseudo />

      <h2 id="wallets">About wrapping wallets</h2>
      <p>
        A helper that wraps a viem wallet client cannot protect a key that can still broadcast on its own. The SDK will only
        offer wallet wrapping for constrained smart-account signers, and will refuse to wrap a plain EOA as if it were
        protected.
      </p>

      <h2 id="roadmap">Build order</h2>
      <ol>
        <li>Canonical REST and authorization protocol.</li>
        <li>TypeScript SDK with viem.</li>
        <li>Protected smart-account integration.</li>
        <li>Python SDK.</li>
        <li>ethers adapter.</li>
        <li>Agent-framework examples, all calling the same protected interface.</li>
      </ol>
    </DocArticle>
  );
}

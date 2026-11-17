import type { Metadata } from "next";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "TypeScript SDK",
  description: "@palisec/sdk: ask Palisec before every agent transaction and send with viem or ethers only on ALLOW. Typed decisions, typed errors, idempotent retries.",
  alternates: { canonical: "/docs/sdk/typescript" },
};

const INSTALL = `npm install https://palisec.tech/sdk/palisec-sdk-0.6.0.tgz viem
# or: pnpm add https://palisec.tech/sdk/palisec-sdk-0.6.0.tgz viem`;

const ETHERS = `import { JsonRpcProvider, Wallet } from "ethers";
import { createPalisec, fromEthers } from "@palisec/sdk";

const provider = new JsonRpcProvider("https://rpc.testnet.chain.robinhood.com");
const wallet = await fromEthers(new Wallet(process.env.AGENT_KEY!, provider)); // checks the network

const { hash } = await palisec.sendTransaction(wallet, { to: TOKEN, data, gasLimit: 90_000 });`;

const SEND = `import { createWalletClient, http, encodeFunctionData, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPalisec, PalisecDeniedError } from "@palisec/sdk";

const palisec = createPalisec({ apiKey: process.env.PALISEC_API_KEY! }); // server-side only

// The agent's own account: the one you registered in Console → Agents.
const wallet = createWalletClient({
  account: privateKeyToAccount(process.env.AGENT_KEY as \`0x\${string}\`),
  transport: http("https://rpc.testnet.chain.robinhood.com"),
});

try {
  const { operation, hash } = await palisec.sendTransaction(wallet, {
    to: TOKEN,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [RECIPIENT, 5n] }),
    gasLimit: 90_000,                 // the fee bound Palisec checks against your policy
  });
  if (hash) console.log("sent", hash, "under", operation.authorizationId);
  else console.log("held for a human approver:", operation.operationId);
} catch (e) {
  if (e instanceof PalisecDeniedError) console.warn(e.code, e.message); // nothing was sent
  else throw e;
}`;

const DECISIONS = `const op = await palisec.authorize({ to, data, gasLimit: 90_000 });

switch (op.decision) {
  case "ALLOW":                      // op.authorizationId, op.expiresAt (5 minutes)
    break;
  case "REQUIRES_HUMAN_SIGNATURE":   // op.operationId; nothing is authorized yet
    const approved = await palisec.waitForApproval(op.operationId!);
    break;
  case "DENY":                       // op.reasonCode, op.message; never send it
    break;
}`;

const ERRORS = `import { PalisecError, PalisecTimeoutError } from "@palisec/sdk";

try {
  await palisec.authorize(intent);
} catch (e) {
  if (e instanceof PalisecTimeoutError) {
    // Safe: the request ID is the idempotency key, so this returns the original decision.
    await palisec.authorize(intent);
  } else if (e instanceof PalisecError) {
    console.error(e.code, e.status, e.requestId); // e.g. PS_AUTH_001, PS_RATE_001, PS_STATE_001
  }
}`;

const FRAMEWORKS = `import { createPalisec, createPalisecTools } from "@palisec/sdk";

const palisec = createPalisec({ apiKey: process.env.PALISEC_API_KEY! });
const tools = createPalisecTools(palisec, { wallet });   // omit wallet: evaluate and read only

// OpenAI Agents SDK (@openai/agents)
import { Agent, tool } from "@openai/agents";
const agent = new Agent({
  name: "trader",
  tools: tools.map((t) => tool({ name: t.name, description: t.description, parameters: t.parameters, strict: false, execute: t.execute })),
});

// Vercel AI SDK (ai)
import { jsonSchema, tool as aiTool } from "ai";
const aiTools = Object.fromEntries(tools.map((t) => [t.name, aiTool({ description: t.description, inputSchema: jsonSchema(t.parameters), execute: t.execute })]));

// LangGraph / LangChain (@langchain/core)
import { DynamicStructuredTool } from "@langchain/core/tools";
const lcTools = tools.map((t) => new DynamicStructuredTool({ name: t.name, description: t.description, schema: t.parameters, func: t.execute }));`;

const CONFIG = `createPalisec({
  apiKey: process.env.PALISEC_API_KEY!,  // ps_test_… ; validated on construction
  // chainId is optional: a ps_live_ key is mainnet (4663), a ps_test_ key is testnet (46630)
  baseUrl: "https://palisec.tech/api/v1",
  timeoutMs: 15_000,                     // per request
  maxRetries: 2,                         // network errors, 429 and 5xx, on safe calls only
  logger: (e) => console.debug(e),       // never includes the key, bodies or calldata
});`;

export default function TypeScriptSdk() {
  return (
    <DocArticle
      title="TypeScript SDK"
      lede="@palisec/sdk asks Palisec before every transaction and sends with your viem wallet only on ALLOW. It holds no security logic of its own: every decision is made and recorded server-side."
      maturity="service"
      compat="@palisec/sdk 0.6.0 · viem or ethers v6 · Schema 1.0 · mainnet 4663 · testnet 46630"
    >
      <Note kind="warning" title="What the SDK enforces">
        <code>sendTransaction</code> refuses to send a denied or unapproved transaction from your process, but a plain key used elsewhere can
        still transact. <code>executeWithSmartAccount</code> is enforced on chain: the agent&apos;s 
        <Link href="/docs/account-abstraction">PALISEC smart account</Link> moves nothing without PALISEC&apos;s co-signature.
      </Note>

      <h2 id="install">Install</h2>
      <p>The package is served from palisec.tech; no registry account is needed. Node 18 or later.</p>
      <CodeBlock code={INSTALL} title="terminal" />
      <p>
        You need an agent API key: sign in, create and activate a policy, register the agent and create a key (see the{" "}
        <Link href="/docs/quickstart">quickstart</Link>).
      </p>

      <h2 id="send">Send only on ALLOW</h2>
      <CodeBlock code={SEND} title="agent.ts" />
      <ul>
        <li>The wallet must be the agent&apos;s registered account, or the SDK refuses before sending.</li>
        <li>The transaction is sent with the gas limit Palisec bounded the fee on.</li>
        <li>A wallet on another chain is refused before sending.</li>
        <li>Pass <code>{`{ waitForApproval: true }`}</code> to wait for an approver and then send; by default a held operation is returned unsent.</li>
      </ul>

      <h2 id="ethers">With ethers</h2>
      <p>
        <code>fromEthers</code> adapts an ethers v6 signer. It checks the provider&apos;s network and pins the chain ID on every transaction, so
        ethers refuses a mismatch. The account check still applies.
      </p>
      <CodeBlock code={ETHERS} title="agent-ethers.ts" />

      <h2 id="decisions">Decisions</h2>
      <p>
        <code>authorize</code> records the decision and its budget reservation and returns it; it does not throw on DENY.{" "}
        <code>evaluate</code> is the same check as a dry run that reserves nothing.
      </p>
      <CodeBlock code={DECISIONS} title="decisions.ts" />

      <h2 id="errors">Errors and retries</h2>
      <p>
        Every failure is a <code>PalisecError</code> with a stable <code>code</code>: the <Link href="/docs/errors">reason codes</Link> plus{" "}
        <code>PS_SDK_CONFIG</code>, <code>PS_SDK_TIMEOUT</code> and <code>PS_SDK_NETWORK</code>. Subclasses: <code>PalisecDeniedError</code>,{" "}
        <code>PalisecApprovalError</code> (rejected, expired or withdrawn), <code>PalisecTimeoutError</code>, <code>PalisecConfigError</code>.
      </p>
      <CodeBlock code={ERRORS} title="errors.ts" />
      <p>
        Retries are automatic only where they are provably safe: authorizations carry the request ID as an idempotency key, dry runs and reads
        change nothing. <code>cancel</code> is never retried.
      </p>

      <h2 id="frameworks">Agent frameworks</h2>
      <p>
        <code>createPalisecTools</code> returns framework-neutral tools (name, description, JSON Schema, <code>execute</code>) that the OpenAI Agents SDK, the Vercel AI SDK and
        LangGraph accept as they are. They hold no security logic: <code>palisec_send_transaction</code> calls <code>sendTransaction</code>, so it sends only on ALLOW and returns
        &quot;sent&quot;, &quot;held_for_approval&quot; or &quot;denied&quot; as text the model can act on. The toolkit is unit-tested; the framework wiring below follows each framework&apos;s documented tool API.
      </p>
      <CodeBlock code={FRAMEWORKS} title="frameworks.ts" />

      <h2 id="config">Configuration</h2>
      <CodeBlock code={CONFIG} title="config.ts" />

      <h2 id="reference">Reference</h2>
      <ul>
        <li><code>authorize(intent)</code>: record a decision. Intent: <code>to</code>, <code>value</code>, <code>data</code>, <code>gasLimit</code>, <code>requestId</code>, <code>deadlineSeconds</code>.</li>
        <li><code>evaluate(intent)</code>: dry run.</li>
        <li><code>sendTransaction(wallet, intent, options)</code>: authorize, then send with viem only if allowed.</li>
        <li><code>getOperation(id)</code>, <code>waitForApproval(id, {"{ timeoutMs, intervalMs }"})</code>, <code>cancel(id)</code> (withdraws a pending approval).</li>
        <li><code>fromEthers(signer, {"{ chainId }"})</code>: adapt an ethers v6 signer.</li>
        <li><code>redact(text)</code>, <code>REASON_CODES</code>, <code>RETRYABLE</code>.</li>
      </ul>
      <p>
        The SDK is a client for the <Link href="/docs/api">REST API</Link>; everything it does is also available over HTTP.
      </p>
    </DocArticle>
  );
}

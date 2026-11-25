import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "MCP server",
  description: "Connect MCP-compatible agents to Palisec over Streamable HTTP with a scoped API key. Tools for evaluation, proposals, status, explanations and policy validation.",
  alternates: { canonical: "/docs/mcp" }, openGraph: pageOpenGraph("/docs/mcp"),
};

const CONFIG = `{
  "mcpServers": {
    "palisec": {
      "type": "http",
      "url": "https://palisec.tech/api/mcp",
      "headers": { "Authorization": "Bearer \${PALISEC_API_KEY}" }
    }
  }
}`;

const CLIENT = `import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://palisec.tech/api/mcp"), {
  requestInit: { headers: { authorization: \`Bearer \${process.env.PALISEC_API_KEY}\` } },
}));

const result = await client.callTool({
  name: "palisec_propose_transaction",
  arguments: { request_id: crypto.randomUUID(), chain_id: 46630, to: TOKEN, value_wei: "0",
               data: calldata, gas_limit: 90000, deadline: Math.floor(Date.now() / 1000) + 120 },
});
// result.structuredContent.decision is ALLOW, DENY or REQUIRES_HUMAN_SIGNATURE`;

const TOOLS: [string, string, string][] = [
  ["palisec_get_account", "policy:read", "The agent, protected account, chain, scopes, bound policy and emergency-stop state."],
  ["palisec_get_policy", "policy:read", "The exact active policy version the agent is evaluated against."],
  ["palisec_evaluate_transaction", "operations:write", "Dry run. Reserves and records nothing."],
  ["palisec_propose_transaction", "operations:write", "Records a decision with its budget reservation. Retry-safe by request_id."],
  ["palisec_get_transaction_status", "operations:read", "State of one of the agent's operations."],
  ["palisec_get_approval_status", "operations:read", "Approved, rejected, withdrawn or expired."],
  ["palisec_request_human_approval", "operations:read", "Where approvers act on a held operation. It cannot approve anything."],
  ["palisec_withdraw_approval_request", "operations:write", "Withdraw the agent's own pending approval."],
  ["palisec_explain_authorization", "operations:read", "The deciding check, reason code and what to do next."],
  ["palisec_get_audit_events", "audit:read", "Audit events the agent caused."],
  ["palisec_validate_policy", "policy:read", "Validate a document against any supported schema version. Saves nothing."],
  ["palisec_simulate_policy", "policy:read", "Evaluate a draft against one transaction with live inputs. Saves nothing."],
];

export default function McpDocs() {
  return (
    <DocArticle
      title="MCP server"
      lede="An official Palisec MCP server for MCP-compatible agents and applications. It is a standard interface to the same authorization path as the REST API, not a separate security mechanism."
      maturity="service"
      compat="MCP TypeScript SDK 2.4 · Streamable HTTP (stateless) · mainnet 4663 · testnet 46630"
    >
      <Note kind="warning" title="MCP is an interface, not the authority">
        Every tool runs under the API key&apos;s scopes, tenant boundary, rate limits and audit. A model reading ALLOW cannot turn it into an authorization: only the recorded operation is one.
        There is no activation, approval or signing tool.
      </Note>
      <h2 id="connect">Connect</h2>
      <p>
        Endpoint: <code>https://palisec.tech/api/mcp</code> (Streamable HTTP, stateless). Authenticate with an agent API key that has the <code>mcp</code> scope (create one in Console →
        Integrations). Each tool also checks its own scope, so an MCP key can be read-only.
      </p>
      <CodeBlock code={CONFIG} title="mcp.json" />
      <p>From code, with the official MCP client:</p>
      <CodeBlock code={CLIENT} title="mcp-client.ts" />
      <h2 id="tools">Tools</h2>
      <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Scope</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {TOOLS.map(([t, s, d]) => (
            <tr key={t}>
              <td><code>{t}</code></td>
              <td><code>{s}</code></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <h2 id="errors">Errors</h2>
      <p>
        Tool failures return <code>isError: true</code> with <code>{`{ error: { code, message, retryable } }`}</code> using the same <Link href="/docs/errors">reason codes</Link>. A key without the{" "}
        <code>mcp</code> scope, or a revoked key, is refused at connection (HTTP 401/403). Input is validated against each tool&apos;s schema.
      </p>
      <h2 id="limits">Limits</h2>
      <ul>
        <li>Same rate limit as the REST API: 120 requests a minute per key.</li>
        <li>Request bodies up to 256 KB. No sessions are held between requests.</li>
        <li>If the MCP endpoint is unavailable, the REST API and SDKs keep working independently.</li>
      </ul>
    </DocArticle>
  );
}

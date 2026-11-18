import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";

export const metadata: Metadata = {
  title: "Integrations and keys",
  description: "Register an external agent, create least-privilege API keys, rotate and revoke them, and read the agent's own policy, operations and audit trail.",
  alternates: { canonical: "/docs/integrations" }, openGraph: pageOpenGraph("/docs/integrations"),
};

const CREATE = `POST /api/v1/agents/{agent_id}/credentials        (console session, admin)
{ "label": "production", "scopes": ["operations:write", "operations:read", "policy:read"] }

→ 201 { "id": "…", "prefix": "ps_test_1a2b3c4d", "scopes": [...], "secret": "ps_test_…" }   # shown once`;

const SELF = `GET /api/v1/integration                 any valid key: agent, account, chain, scopes, bound policy
GET /api/v1/integration/policy          policy:read     the exact active policy version and document
GET /api/v1/integration/operations      operations:read its own operations (no calldata)
GET /api/v1/integration/audit-events    audit:read      audit events it caused`;

export default function IntegrationDocs() {
  return (
    <DocArticle title="Integrations and keys" lede="Every external agent is a registered agent bound to one protected account and policy. Its API keys are its credentials: scoped, rotatable and revocable." maturity="service">
      <h2 id="register">Register</h2>
      <p>In Console → Agents, register the agent with its smart account, chain and policy. Optionally record its framework. The name is a label, never an identity: the key authenticates.</p>
      <h2 id="scopes">Scoped keys</h2>
      <CodeBlock code={CREATE} title="HTTP" />
      <ul>
        <li><code>operations:write</code>: authorize, dry-run, withdraw its own pending approvals.</li>
        <li><code>operations:read</code>: read its own operations.</li>
        <li><code>policy:read</code>: read its bound policy version.</li>
        <li><code>audit:read</code>: read its own audit events.</li>
        <li><code>mcp</code>: connect through the MCP server.</li>
      </ul>
      <p>Keys created before scopes existed hold all of them, so existing integrations keep working. A key can never change its own scopes.</p>
      <h2 id="rotate">Rotate and revoke</h2>
      <p>
        <code>POST /api/v1/credentials/{"{id}"}/rotate</code> issues a new secret with the same agent, label and scopes and revokes the old key in the same database statement. Revocation takes effect on
        the next request. Both are audited.
      </p>
      <h2 id="self">What a key can read about itself</h2>
      <CodeBlock code={SELF} title="HTTP" />
    </DocArticle>
  );
}

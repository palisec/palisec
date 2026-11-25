import type { Metadata } from "next";
import { pageOpenGraph } from "@/lib/seo";
import Link from "next/link";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Palisec Agent",
  description: "How the native Palisec Agent works: tools, autonomy levels, confirmed actions, model configuration, evidence and the API.",
  alternates: { canonical: "/docs/agent" }, openGraph: pageOpenGraph("/docs/agent"),
};

export default function AgentDocs() {
  return (
    <DocArticle title="Palisec Agent" lede="The native security operator in the console: investigation, policy engineering and operations assistance over your real records." maturity="service" compat="Instructions agent-2026-11-16.2 · OpenAI-compatible providers">
      <Note kind="warning" title="The agent is not an authority">
        It cannot authorize, approve, sign, activate a policy or change its own permissions. The deterministic engine decides every transaction. Actions the agent prepares run only after a
        member with the right role confirms them.
      </Note>
      <h2 id="use">Use it</h2>
      <p>
        Open <Link href="/console/agent">Console → Palisec Agent</Link>. Ask in plain language, or run a quick investigation (security state, open findings, integration status, explain an
        operation or error code) that calls a tool directly without a model.
      </p>
      <h2 id="levels">Autonomy levels</h2>
      <ul>
        <li><strong>0 Observe</strong>: read tools only.</li>
        <li><strong>1 Assist</strong> (default): also draft, validate, simulate and prepare.</li>
        <li><strong>2 Confirmed actions</strong>: also request an emergency stop, an agent pause, or saving a policy draft. Each is confirmed by a person.</li>
      </ul>
      <p>Admins set the level and can disable individual tools or the whole agent. Members see only the tools their role allows.</p>
      <h2 id="evidence">Evidence and citations</h2>
      <p>
        Every tool call is recorded with its input, a minimized output, the records it returned and its duration. Answers cite records as <code>[operation:id]</code>; the console links each one,
        and flags any citation that no tool returned in that run.
      </p>
      <h2 id="model">Model provider</h2>
      <p>
        Any OpenAI-compatible chat-completions API with tool calling. The provider and model are configurable. Configuration is server-side only:{" "}
        <code>PALISEC_AGENT_API_KEY</code>, optional <code>PALISEC_AGENT_BASE_URL</code> and <code>PALISEC_AGENT_MODEL</code>. Without a key, conversation is off and direct tools still work.
      </p>
      <h2 id="api">API</h2>
      <ul>
        <li><code>GET /api/v1/agent/tools</code>, <code>GET|PATCH /api/v1/agent/configuration</code></li>
        <li><code>POST /api/v1/agent/runs</code>, <code>GET /api/v1/agent/runs/{"{id}"}</code>, <code>POST …/messages</code>, <code>POST …/continue</code>, <code>POST …/cancel</code>, <code>GET …/events</code></li>
        <li><code>POST /api/v1/agent/tools/{"{name}"}</code> (direct tool call)</li>
        <li><code>POST /api/v1/agent/actions/{"{id}"}/confirm</code>, <code>…/reject</code>, <code>GET /api/v1/agent/activity</code></li>
      </ul>
      <p>Runs advance a few steps per request within a time budget; continue a run until <code>can_continue</code> is false. All routes need a console session.</p>
    </DocArticle>
  );
}

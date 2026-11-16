import type { Metadata } from "next";
import Link from "next/link";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";
import { ENDPOINTS } from "@/lib/api-reference";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every Palisec REST endpoint: authentication, roles, request fields, idempotency, pagination and errors. OpenAPI 3.1 included.",
  alternates: { canonical: "/docs/api" },
};

const AUTH_TEXT = { none: "Public", session: "Console session", key: "API key", "session or key": "Session or API key" } as const;

export default function ApiReference() {
  return (
    <DocArticle
      title="API reference"
      lede="Base URL https://palisec.tech/api/v1. JSON in, JSON out, integers as decimal strings. Machine-readable contract: /api/v1/openapi.json (OpenAPI 3.1)."
      maturity="service"
    >
      <Note kind="warning" title="Testnet, pre-release">
        Only Robinhood Chain Testnet (46630) is enabled. Decisions are recorded and enforced for agents that call the API; this release
        does not sign or broadcast transactions.
      </Note>

      <h2 id="auth">Authentication</h2>
      <ul>
        <li><strong>Agents</strong> send <code>Authorization: Bearer ps_test_…</code>. Keys belong to one agent, are shown once and are stored only as a SHA-256 hash. Never put a key in a URL.</li>
        <li><strong>People</strong> use the console session from wallet sign-in. State changes must come from this site (the <code>Origin</code> header is checked). With several organizations, choose one with the <code>x-ps-org</code> header.</li>
        <li><strong>Roles</strong> are checked on every request: viewer reads; operator also pauses agents and engages the emergency stop; approver signs approvals; admin manages agents, keys and policies; owner also manages members and lifts the stop.</li>
      </ul>

      <h2 id="errors">Errors</h2>
      <p>
        Every refusal is <code>{`{ request_id, error: { code, message, retryable } }`}</code> with a stable <Link href="/docs/errors">reason code</Link>. A
        denied operation is not an error: it returns <code>decision: &quot;DENY&quot;</code> with its reason. When the database or a required input is
        unavailable the API answers <code>503 PS_STATE_001</code> and authorizes nothing. Keys are limited to 120 requests a minute (<code>429 PS_RATE_001</code>
        with <code>Retry-After</code>). Every response carries an <code>X-Request-Id</code> header, the same value as an error&apos;s <code>request_id</code>: quote it
        when you contact support. Bodies are limited to 16 KB of valid UTF-8 JSON.
      </p>

      <h2 id="lifecycle">Operation states</h2>
      <ul>
        <li><code>authorized</code>: ALLOW. Usable until <code>expires_at</code> (5 minutes); its amount stays reserved for the rolling hour.</li>
        <li><code>pending_approval</code>: waiting up to 15 minutes for an approver; then <code>approved</code> (a fresh 5-minute authorization), <code>rejected</code> or <code>expired</code>.</li>
        <li><code>denied</code>, <code>cancelled</code>, <code>authorization_expired</code>: terminal. Nothing in this release moves an operation to executed: that needs receipt reconciliation.</li>
      </ul>

      {ENDPOINTS.map((g) => (
        <section key={g.group}>
          <h2 id={g.group.toLowerCase().replace(/[^a-z]+/g, "-")}>{g.group}</h2>
          <div className="not-prose space-y-4">
            {g.items.map((e) => (
              <div key={`${e.method} ${e.path}`} className="border border-line p-4">
                <p className="font-mono text-[13px] text-fg">
                  <span className="mr-2 text-aqua">{e.method}</span>
                  {e.path}
                </p>
                <p className="mt-1 text-sm text-soft">{e.summary}</p>
                <p className="mt-1 font-mono text-[13px] text-dim">
                  {AUTH_TEXT[e.auth]}
                  {e.role ? ` · ${e.role} or above` : ""}
                </p>
                {e.body && (
                  <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[12.5px]">
                    {Object.entries(e.body).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="font-mono text-fg">{k}</dt>
                        <dd className="text-muted">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {e.notes && <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{e.notes}</p>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </DocArticle>
  );
}

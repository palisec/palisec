import type { Metadata } from "next";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Signed PALISEC events for decisions, approvals, pauses, emergency stops and security findings, with stable event IDs, retries and verification helpers.",
  alternates: { canonical: "/docs/webhooks" },
};

const PAYLOAD = `POST https://your-service.example/palisec
content-type: application/json
palisec-event-id: 0d0c6f0e-…            # stable across retries: deduplicate on it
palisec-event-type: operation.denied
palisec-timestamp: 1794000000
palisec-signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>

{ "id": "0d0c6f0e-…", "type": "operation.denied", "created_at": "…", "organization_id": "…",
  "data": { "operation_id": "…", "request_id": "…", "decision": "DENY", "reason_code": "PS_TARGET_001", … } }`;

const TS = `import { verifyWebhook } from "@palisec/sdk";

// rawBody: the exact request body string, before JSON parsing
const event = await verifyWebhook(process.env.PALISEC_WEBHOOK_SECRET!, rawBody, request.headers);
if (await alreadyHandled(event.id)) return new Response(null, { status: 200 });`;

const PY = `from palisec import webhooks

event = webhooks.verify(os.environ["PALISEC_WEBHOOK_SECRET"], raw_body, request.headers)
# raises webhooks.WebhookVerificationError if forged, modified or older than 5 minutes`;

export default function WebhookDocs() {
  return (
    <DocArticle title="Webhooks" lede="Signed events from PALISEC to your systems. Sent after the response, so a webhook can never delay or change a decision." maturity="service" compat="Events 1.0 · HMAC-SHA256 · testnet 46630">
      <h2 id="events">Events</h2>
      <ul>
        <li><code>operation.allowed</code>, <code>operation.denied</code>, <code>operation.review_required</code>: a new recorded decision (idempotent replays send nothing).</li>
        <li><code>approval.approved</code>, <code>approval.rejected</code>: a human decision on a held operation.</li>
        <li><code>organization.emergency_stop</code>, <code>agent.status_changed</code>, <code>credential.revoked</code>.</li>
        <li><code>security.finding</code>: a new finding from the detectors or the PALISEC Agent.</li>
        <li><code>operation.submitted</code>: PALISEC co-signed an operation for a smart account and the bundler accepted it.</li>
        <li><code>operation.executed</code>: the operation was included on chain, with its transaction hash and whether it succeeded.</li>
        <li><code>ping</code>: sent by Test in the console.</li>
      </ul>
      <h2 id="delivery">Delivery</h2>
      <CodeBlock code={PAYLOAD} title="request" />
      <ul>
        <li>Up to three attempts with backoff on network errors, 429 and 5xx; each attempt reuses the event ID. Failed deliveries can be sent again from the console, with the same ID.</li>
        <li>Respond with any 2xx within 5 seconds. Redirects are not followed.</li>
        <li>Twenty failed events in a row disable the endpoint until a member re-enables it.</li>
        <li>Only public HTTPS endpoints are accepted: no private, loopback, link-local or metadata addresses.</li>
      </ul>
      <h2 id="verify">Verify every delivery</h2>
      <CodeBlock code={TS} title="receiver.ts" />
      <CodeBlock code={PY} title="receiver.py" />
      <p>Both reject a body that was modified, a wrong secret, and timestamps older than five minutes, and compare in constant time. The signing secret is shown once, when you create the webhook.</p>
    </DocArticle>
  );
}

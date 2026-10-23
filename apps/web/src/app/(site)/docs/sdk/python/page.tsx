import type { Metadata } from "next";
import { CodeBlock } from "@/components/copy-button";
import { DocArticle } from "@/components/doc";
import { Note } from "@/components/ui";

export const metadata: Metadata = {
  title: "Python SDK",
  description: "Planned async-first Python client for Palisec, with parity to the canonical API.",
  alternates: { canonical: "/docs/sdk/python" },
};

const EXAMPLE = `from palisec import Palisec, Denied, PendingApproval

async with Palisec(api_key=os.environ["PALISEC_API_KEY"], chain_id=46630) as wall:
    result = await wall.operations.create(
        account=SMART_ACCOUNT, to=ROUTER, value=40_000_000_000_000_000,
        data=calldata, idempotency_key=str(uuid4()),
    )
    match result:
        case Denied(reason_code=code):
            log.info("denied", code=code)       # no transaction hash exists
        case PendingApproval(approval_id=aid):
            await wall.approvals.wait(aid)`;

export default function PythonSdk() {
  return (
    <DocArticle
      title="Python SDK"
      lede="An async-first client for Python agents. It will be published only once its security semantics match the canonical API exactly."
      maturity="planned"
      compat="Schema 1.0 · planned · after the TypeScript SDK"
    >
      <Note title="Planned">
        No Python package exists yet. A Python wrapper must never become a route around the policy engine, so it ships after the
        protocol and TypeScript SDK are stable.
      </Note>
      <h2 id="shape">Intended shape</h2>
      <CodeBlock code={EXAMPLE} title="agent.py" pseudo />
      <h2 id="parity">Parity requirements</h2>
      <ul>
        <li>Typed configuration and models.</li>
        <li>Protected operation submission with idempotency keys and bounded retries.</li>
        <li>Typed errors for every reason code.</li>
        <li>Approval status handling with expiry.</li>
        <li>Logging with secret redaction.</li>
        <li>Agent-framework examples that call the same protected interface, with no framework-specific security logic.</li>
      </ul>
    </DocArticle>
  );
}

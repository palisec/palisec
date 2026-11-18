import { SCENARIOS } from "@palisec/policy-schema";
import { POST as evaluate } from "@/app/api/v1/authorizations/evaluate/route";
import { BadRequest, HttpError, handle, logEvent, ok, rateLimited, readJson, sameOrigin } from "@/server/http";

/** The demo organization's fixed policy lives on testnet; nothing here can reach mainnet. */
const TESTNET = 46630;
const MAX_BODY_BYTES = 1024;
/** A realistic contract-call gas limit, so the fee check uses a live estimate of a real call. */
const GAS_LIMIT = 250_000;

/**
 * POST /api/demo/evaluate · the homepage workbench's Live API mode. Body: { "scenario": "<example id>" }.
 * Sends that example to the real dry-run endpoint (POST /v1/authorizations/evaluate) with a demo key
 * held only here (`PALISEC_DEMO_API_KEY`, scope authorizations:evaluate, a dedicated demo organization).
 * The key never reaches the browser; only examples run, so visitors cannot choose the input.
 * Dry runs reserve and record nothing.
 */
export const POST = handle(async (req) => {
  if (!sameOrigin(req)) throw new HttpError(403, "PS_AUTH_001", "The live demo answers this site's pages only");
  if (rateLimited(req, "demo-evaluate", 10)) throw new HttpError(429, "PS_RATE_001", "Too many live demo requests. Try again in a minute.", true);
  const body = await readJson(req, MAX_BODY_BYTES);
  for (const k of Object.keys(body)) if (k !== "scenario") throw new BadRequest(`Unknown field: ${k.slice(0, 40)}`);
  const scenario = SCENARIOS.find((s) => s.id === body.scenario);
  if (!scenario) throw new BadRequest(`scenario must be one of: ${SCENARIOS.map((s) => s.id).join(", ")}`);
  const key = process.env.PALISEC_DEMO_API_KEY ?? "";
  if (!/^ps_test_[0-9a-f]{48}$/.test(key)) throw new HttpError(503, "PS_STATE_001", "The live demo is not configured on this deployment.", true);

  const intent = {
    request_id: `demo_${crypto.randomUUID()}`,
    chain_id: TESTNET,
    to: scenario.intent.to,
    value_wei: scenario.intent.value_wei,
    data: scenario.intent.data,
    gas_limit: GAS_LIMIT,
    deadline: Math.floor(Date.now() / 1000) + 120,
  };
  // The real endpoint, in this process: its own request ID, authentication, scope check and logs.
  const upstream = await evaluate(
    new Request(new URL("/api/v1/authorizations/evaluate", req.url), {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(intent),
    }),
    undefined,
  );
  const apiRequestId = upstream.headers.get("x-request-id");
  const response = (await upstream.json()) as Record<string, unknown>;
  logEvent("info", "demo.evaluate", {
    scenario: scenario.id,
    api_request_id: apiRequestId,
    status: upstream.status,
    decision: response.decision ?? null,
    reason_code: response.reason_code ?? null,
  });
  return ok(
    { scenario: scenario.id, chain_id: TESTNET, api_request_id: apiRequestId, server_time: new Date().toISOString(), status: upstream.status, response },
    { status: upstream.ok ? 200 : upstream.status },
  );
});

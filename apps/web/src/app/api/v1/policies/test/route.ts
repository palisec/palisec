import { requireMember } from "@/server/access";
import { HttpError, handle, ok, rateLimited, readJson } from "@/server/http";
import { MAX_OPERATION_BODY, testDraft } from "@/server/operations";
import { validatePolicy } from "@palisec/policy-schema";

/**
 * Evaluates a policy document (saved or not) against one test transaction with live fee and price
 * inputs and an empty ledger. Records nothing. Body: { document, transaction: { to, value_wei, data, gas_limit } }.
 */
export const POST = handle(async (req) => {
  await requireMember(req, "read");
  if (rateLimited(req, "policy-test", 30)) throw new HttpError(429, "PS_RATE_001", "Too many test runs. Try again in a minute.", true);
  const body = await readJson(req, MAX_OPERATION_BODY + 128 * 1024);
  const doc = body.document;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new HttpError(400, "PS_REQUEST_001", "document must be a policy object");
  const errors = validatePolicy({ ...(doc as object), version: 1, status: "active" });
  if (errors.length) throw new HttpError(422, "PS_POLICY_001", `Draft is invalid: ${errors[0]!.path} ${errors[0]!.message}`);
  const tx = body.transaction;
  if (!tx || typeof tx !== "object" || Array.isArray(tx)) throw new HttpError(400, "PS_REQUEST_001", "transaction must be an object");
  return ok(await testDraft(doc as Record<string, unknown>, tx as Record<string, unknown>));
});

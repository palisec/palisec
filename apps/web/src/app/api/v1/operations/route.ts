import { hasBearer, requireAgent, requireMember } from "@/server/access";
import { listOperations } from "@/server/approvals";
import { afterOperation } from "@/server/events";
import { BadRequest, handle, ok, readJson } from "@/server/http";
import { createOperation, MAX_OPERATION_BODY, parseIntent } from "@/server/operations";

/**
 * Agents create operations with their API key. The decision is recorded atomically with its budget
 * reservation; an Idempotency-Key makes retries return the original result instead of a second one.
 */
export const POST = handle(async (req) => {
  const agent = await requireAgent(req, "operations:write");
  const key = req.headers.get("idempotency-key");
  if (key !== null && !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) throw new BadRequest("Idempotency-Key must be 1-128 characters of A-Z a-z 0-9 _ . : -");
  const { status, body, replayed } = await createOperation(agent, parseIntent(await readJson(req, MAX_OPERATION_BODY)), key);
  afterOperation(agent.orgId, body as unknown as Record<string, unknown>, replayed, agent.chainId);
  return ok(body, { status, headers: replayed ? { "Idempotent-Replayed": "true" } : {} });
});

/** Console listing. Agents read single operations by ID instead. */
export const GET = handle(async (req) => {
  if (hasBearer(req)) throw new BadRequest("List operations from the console; agents read single operations by ID");
  return ok(await listOperations(await requireMember(req, "read"), new URL(req.url).searchParams));
});

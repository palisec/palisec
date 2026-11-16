import "server-only";
import { after } from "next/server";
import { detect } from "./security-events";
import { emit, type EventType } from "./webhooks";

/*
 * Side effects that follow a recorded change: webhook events and security detection. They run
 * after the response is sent (`after()`), so they can neither delay nor alter a decision, and a
 * failure in them is logged, never surfaced to the caller.
 */

const DECISION_EVENT: Record<string, EventType> = {
  ALLOW: "operation.allowed",
  DENY: "operation.denied",
  REQUIRES_HUMAN_SIGNATURE: "operation.review_required",
};

/** After an agent's operation is recorded (REST or MCP). Replayed idempotent results emit nothing. */
export function afterOperation(orgId: string, body: Record<string, unknown>, replayed: boolean) {
  if (replayed || typeof body.operation_id !== "string") return;
  const type = DECISION_EVENT[String(body.decision)];
  if (!type) return;
  after(async () => {
    await emit(orgId, type, {
      operation_id: body.operation_id,
      request_id: body.request_id,
      decision: body.decision,
      reason_code: body.reason_code ?? null,
      state: body.state,
      policy_id: body.policy_id ?? null,
      policy_version: body.policy_version ?? null,
      authorization_id: body.authorization_id ?? null,
      expires_at: body.expires_at ?? null,
    });
    if (body.decision !== "ALLOW") await detect(orgId);
  });
}

/** After any other control-plane change worth announcing. */
export function afterChange(orgId: string, type: EventType, data: Record<string, unknown>, runDetection = false) {
  after(async () => {
    await emit(orgId, type, data);
    if (runDetection) await detect(orgId, true);
  });
}

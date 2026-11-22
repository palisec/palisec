import "server-only";
import type { Policy } from "@palisec/policy-schema";
import type { MemberContext } from "./access";
import { activatePolicy, getAgent, getPolicy, saveDraft } from "./control";
import { afterChange } from "./events";
import { HttpError } from "./http";

/**
 * Phase 9: the owner resets a breached loss limit. The reset is a new policy version with
 * loss_limit.reset_epoch + 1, so it is a loosening: it waits for the organization's delay (alert,
 * countdown, Cancel) and is published through the Phase 8 registry like every other policy change. When
 * it applies, the pause clears and the window starts again from the account's value at that moment.
 */
export async function requestLossReset(ctx: MemberContext, agentId: string, body: Record<string, unknown>) {
  const agent = (await getAgent(ctx, agentId)) as Record<string, unknown>;
  const policyId = agent.policy_id as string | null;
  if (!policyId) throw new HttpError(409, "PS_POLICY_001", "This agent has no policy");
  const policy = await getPolicy(ctx, policyId);
  const active = policy.active_document as Policy | null;
  if (!active?.loss_limit?.enabled) throw new HttpError(409, "PS_POLICY_001", "This agent's policy has no loss limit to reset");
  if (policy.pending) throw new HttpError(409, "PS_REQUEST_001", "Another change to this policy is already pending. Cancel it first.");
  const { version: _v, status: _s, ...rest } = active as Policy & Record<string, unknown>;
  void _v;
  void _s;
  // An edited, not yet activated draft would be replaced: ask first.
  const strip = (d: unknown) => (d && typeof d === "object" ? JSON.stringify({ ...(d as Record<string, unknown>), version: 0, status: "" }) : null);
  if (policy.draft && strip(policy.draft) !== strip(active) && body.replace_draft !== true)
    throw new HttpError(409, "PS_REQUEST_001", 'The policy has an edited draft. Activate or discard it first, or send "replace_draft": true.');
  const draft = { ...rest, status: "draft", version: active.version, loss_limit: { ...active.loss_limit, reset_epoch: active.loss_limit.reset_epoch + 1 } };
  const saved = await saveDraft(ctx, policyId, { document: draft });
  const result = await activatePolicy(ctx, policyId, { confirm: true, draft_hash: saved.draft_hash });
  if (result.state === "pending_activation")
    afterChange(ctx.orgId, "loss_limit.reset_pending", {
      agent_id: agentId, policy_id: policy.policy_key, policy_version: result.activated_version, reset_epoch: draft.loss_limit.reset_epoch, effective_at: result.effective_at,
    });
  return { state: result.state, effective_at: result.effective_at, policy_version: result.activated_version, reset_epoch: draft.loss_limit.reset_epoch };
}

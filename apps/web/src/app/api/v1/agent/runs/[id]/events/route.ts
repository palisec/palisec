import { idParam, requireMember } from "@/server/access";
import { getRun } from "@/server/agent/runtime";
import { handle, ok } from "@/server/http";

/** Tool calls, action requests and evidence for a run (the trace behind its answers). */
export const GET = handle<RouteContext<"/api/v1/agent/runs/[id]/events">>(async (req, ctx) => {
  const r = await getRun(await requireMember(req, "read"), await idParam(ctx));
  return ok({ run_id: r.id, status: r.status, tool_calls: r.tool_calls, action_requests: r.action_requests, evidence: r.evidence, unverified_citations: r.unverified_citations });
});

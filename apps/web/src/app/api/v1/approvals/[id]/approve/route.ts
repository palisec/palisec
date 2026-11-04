import { idParam, requireMember } from "@/server/access";
import { approve } from "@/server/approvals";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/approvals/[id]/approve">>(async (req, ctx) =>
  ok(await approve(await requireMember(req, "approve"), await idParam(ctx), await readJson(req))),
);

import { idParam, requireMember } from "@/server/access";
import { reject } from "@/server/approvals";
import { handle, ok, readJson } from "@/server/http";

export const POST = handle<RouteContext<"/api/v1/approvals/[id]/reject">>(async (req, ctx) =>
  ok(await reject(await requireMember(req, "approve"), await idParam(ctx), await readJson(req))),
);

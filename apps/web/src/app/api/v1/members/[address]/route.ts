import { requireMember } from "@/server/access";
import { removeMember } from "@/server/control";
import { handle, ok } from "@/server/http";

export const DELETE = handle<RouteContext<"/api/v1/members/[address]">>(async (req, ctx) =>
  ok({ members: await removeMember(await requireMember(req, "own"), (await ctx.params).address) }),
);

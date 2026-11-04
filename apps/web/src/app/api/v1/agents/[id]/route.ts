import { idParam, requireMember } from "@/server/access";
import { getAgent, updateAgent } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

type Ctx = RouteContext<"/api/v1/agents/[id]">;

export const GET = handle<Ctx>(async (req, ctx) => ok(await getAgent(await requireMember(req, "read"), await idParam(ctx))));

export const PATCH = handle<Ctx>(async (req, ctx) =>
  ok(await updateAgent(await requireMember(req, "manage"), await idParam(ctx), await readJson(req))),
);

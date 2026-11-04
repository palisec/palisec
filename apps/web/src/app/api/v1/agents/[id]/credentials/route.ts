import { idParam, requireMember } from "@/server/access";
import { createCredential } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

/** The response is the only time the secret is ever visible. */
export const POST = handle<RouteContext<"/api/v1/agents/[id]/credentials">>(async (req, ctx) =>
  ok(await createCredential(await requireMember(req, "manage"), await idParam(ctx), await readJson(req)), { status: 201 }),
);

import { idParam, requireMember } from "@/server/access";
import { deleteDraftPolicy, getPolicy, saveDraft } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

type Ctx = RouteContext<"/api/v1/policies/[id]">;

export const GET = handle<Ctx>(async (req, ctx) => ok(await getPolicy(await requireMember(req, "read"), await idParam(ctx))));

/** Saves the draft. Drafts may be invalid while being edited; activation requires a valid one. */
export const PUT = handle<Ctx>(async (req, ctx) =>
  ok(await saveDraft(await requireMember(req, "manage"), await idParam(ctx), await readJson(req, 128 * 1024))),
);

/** Deletes a policy that was never activated (owner or admin, with confirm). Activated policies can only be disabled. */
export const DELETE = handle<Ctx>(async (req, ctx) =>
  ok(await deleteDraftPolicy(await requireMember(req, "manage"), await idParam(ctx), await readJson(req))),
);

import { idParam, requireMember } from "@/server/access";
import { rotateCredential } from "@/server/control";
import { handle, ok } from "@/server/http";

/** Replaces a key with a new secret (same agent, label and scopes) and revokes the old one atomically. */
export const POST = handle<RouteContext<"/api/v1/credentials/[id]/rotate">>(async (req, ctx) =>
  ok(await rotateCredential(await requireMember(req, "manage"), await idParam(ctx)), { status: 201 }),
);

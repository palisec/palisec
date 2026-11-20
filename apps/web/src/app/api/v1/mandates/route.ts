import { requireMember } from "@/server/access";
import { handle, ok, readJson } from "@/server/http";
import { createMandate, listMandates } from "@/server/mandates";

/** Phase 7: holder mandates of this organization. Creating one needs the manage permission. */
export const GET = handle(async (req) => ok({ mandates: await listMandates(await requireMember(req, "read")) }));
export const POST = handle(async (req) => ok(await createMandate(await requireMember(req, "manage"), await readJson(req)), { status: 201 }));

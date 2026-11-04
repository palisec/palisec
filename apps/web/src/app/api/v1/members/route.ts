import { requireMember } from "@/server/access";
import { listMembers, upsertMember } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const GET = handle(async (req) => ok({ members: await listMembers(await requireMember(req, "read")) }));

export const POST = handle(async (req) => ok({ members: await upsertMember(await requireMember(req, "own"), await readJson(req)) }));

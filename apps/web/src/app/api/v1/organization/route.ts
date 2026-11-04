import { requireMember } from "@/server/access";
import { getOrganization, renameOrganization } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const GET = handle(async (req) => ok(await getOrganization(await requireMember(req, "read"))));

export const PATCH = handle(async (req) => ok(await renameOrganization(await requireMember(req, "own"), await readJson(req))));

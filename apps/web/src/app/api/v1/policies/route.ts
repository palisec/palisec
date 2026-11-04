import { requireMember } from "@/server/access";
import { createPolicy, listPolicies } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const GET = handle(async (req) => ok({ policies: await listPolicies(await requireMember(req, "read")) }));

export const POST = handle(async (req) =>
  ok(await createPolicy(await requireMember(req, "manage"), await readJson(req, 128 * 1024)), { status: 201 }),
);

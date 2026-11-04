import { requireMember } from "@/server/access";
import { createAgent, listAgents } from "@/server/control";
import { handle, ok, readJson } from "@/server/http";

export const GET = handle(async (req) => ok({ agents: await listAgents(await requireMember(req, "read")) }));

export const POST = handle(async (req) => ok(await createAgent(await requireMember(req, "manage"), await readJson(req)), { status: 201 }));

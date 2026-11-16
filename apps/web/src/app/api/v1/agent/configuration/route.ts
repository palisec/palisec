import { requireMember } from "@/server/access";
import { getConfig, updateConfig } from "@/server/agent/runtime";
import { handle, ok, readJson } from "@/server/http";

export const GET = handle(async (req) => ok(await getConfig((await requireMember(req, "read")).orgId)));

/** Admins set whether the agent is enabled, its autonomy level (0-2) and disabled tools. */
export const PATCH = handle(async (req) => {
  const m = await requireMember(req, "manage");
  return ok(await updateConfig(m, await readJson(req)));
});

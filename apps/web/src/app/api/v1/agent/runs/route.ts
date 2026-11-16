import { requireMember } from "@/server/access";
import { listRuns, startRun } from "@/server/agent/runtime";
import { handle, ok, readJson } from "@/server/http";

export const maxDuration = 60;

export const GET = handle(async (req) => ok({ runs: await listRuns(await requireMember(req, "read")) }));

/** Starts a run with a first message and advances it within this request's time budget. */
export const POST = handle(async (req) => {
  const m = await requireMember(req, "read");
  return ok(await startRun(m, await readJson(req)), { status: 201 });
});

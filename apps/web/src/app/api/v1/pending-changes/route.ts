import { requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { listPending } from "@/server/pending";

/** Phase 6: every change waiting out the loosening delay in this organization (the console banner reads this). */
export const GET = handle(async (req) => {
  const m = await requireMember(req, "read");
  return ok({ pending: await listPending(m.orgId), server_time: new Date().toISOString() });
});

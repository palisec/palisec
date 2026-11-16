import { requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { listIntegrations } from "@/server/integrations";

/** Console: integrations (registered agents) with credentials, scopes, activity and webhook health. */
export const GET = handle(async (req) => ok(await listIntegrations(await requireMember(req, "read"))));

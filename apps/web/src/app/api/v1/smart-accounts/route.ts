import { hasBearer, requireAgent, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { agentAccounts, smartAccountConfig } from "@/server/smart-accounts";

/** Smart-account configuration (addresses only). Members also get each agent's account, inspected on chain. */
export const GET = handle(async (req: Request) => {
  if (hasBearer(req)) {
    await requireAgent(req, null);
    return ok(smartAccountConfig());
  }
  const m = await requireMember(req, "read");
  return ok({ ...smartAccountConfig(), agents: await agentAccounts(m.orgId) });
});

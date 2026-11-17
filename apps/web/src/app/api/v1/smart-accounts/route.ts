import { hasBearer, requireAgent, requireMember } from "@/server/access";
import { handle, ok } from "@/server/http";
import { agentAccounts, requestedChain, smartAccountConfig } from "@/server/smart-accounts";

/**
 * Smart-account configuration for one network (?chain_id=, default: the deployment's main network).
 * Addresses only. An agent gets its own network; members also get each agent's account, inspected on chain.
 */
export const GET = handle(async (req: Request) => {
  if (hasBearer(req)) {
    const agent = await requireAgent(req, null);
    return ok(smartAccountConfig(agent.chainId));
  }
  const m = await requireMember(req, "read");
  const chainId = requestedChain(req);
  return ok({ ...smartAccountConfig(chainId), agents: await agentAccounts(m.orgId, chainId) });
});

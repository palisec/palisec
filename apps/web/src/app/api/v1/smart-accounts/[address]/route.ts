import { hasBearer, requireAgent, requireMember } from "@/server/access";
import { handle, ok, rateLimited, tooManyRequests } from "@/server/http";
import { inspectAccount, requestedChain } from "@/server/smart-accounts";

/** Reads an account on one network (?chain_id=, or the agent's own): is it a Safe with the 4337 module, Palisec as an owner, and a threshold of 2? */
export const GET = handle<RouteContext<"/api/v1/smart-accounts/[address]">>(async (req, ctx) => {
  const agent = hasBearer(req) ? await requireAgent(req, null) : null;
  if (!agent) await requireMember(req, "read");
  if (rateLimited(req, "inspect-account", 60)) return tooManyRequests();
  const { address } = await ctx.params;
  return ok(await inspectAccount(agent ? agent.chainId : requestedChain(req), address));
});

import { hasBearer, requireAgent, requireMember } from "@/server/access";
import { handle, ok, rateLimited, tooManyRequests } from "@/server/http";
import { inspectAccount } from "@/server/smart-accounts";
import { SAFE_4337 } from "@/lib/safe-op";

/** Reads an account on chain: is it a Safe with the 4337 module, PALISEC as an owner, and a threshold of 2? */
export const GET = handle<RouteContext<"/api/v1/smart-accounts/[address]">>(async (req, ctx) => {
  if (hasBearer(req)) await requireAgent(req, null);
  else await requireMember(req, "read");
  if (rateLimited(req, "inspect-account", 60)) return tooManyRequests();
  const { address } = await ctx.params;
  return ok(await inspectAccount(SAFE_4337.chainId, address));
});

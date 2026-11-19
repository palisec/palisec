import { apiError, handle, ok } from "@/server/http";
import { currentUser } from "@/server/session";
import { defaultChain, enabledChainIds } from "@/server/config";
import { smartAccountsStatus } from "@/server/smart-accounts";
import { refreshPro } from "@/server/billing";

export const GET = handle(async (req) => {
  const user = await currentUser(req);
  if (!user) return apiError(401, "PS_AUTH_001", "Not signed in");
  // Pro by holdings: re-checked from the chain at most every 10 minutes while the console is used.
  await Promise.all(user.memberships.map((m) => refreshPro(m.orgId).catch(() => {})));
  return ok({
    address: user.address,
    organizations: user.memberships.map((m) => ({ id: m.orgId, name: m.orgName, role: m.role })),
    // Networks this deployment accepts, so the console offers only those. No secrets, only on/off.
    networks: enabledChainIds().map((chain_id) => ({ chain_id, smart_accounts: smartAccountsStatus(chain_id).available })),
    default_chain: defaultChain(),
  });
});

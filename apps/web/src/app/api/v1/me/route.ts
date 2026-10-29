import { apiError, handle, ok } from "@/server/http";
import { currentUser } from "@/server/session";

export const GET = handle(async (req) => {
  const user = await currentUser(req);
  if (!user) return apiError(401, "RW_AUTH_001", "Not signed in");
  return ok({
    address: user.address,
    organizations: user.memberships.map((m) => ({ id: m.orgId, name: m.orgName, role: m.role })),
  });
});

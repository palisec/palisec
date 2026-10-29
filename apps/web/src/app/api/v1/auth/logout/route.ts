import { apiError, handle, ok, sameOrigin } from "@/server/http";
import { clearedSessionCookie, currentUser, revokeSession } from "@/server/session";

export const POST = handle(async (req) => {
  if (!sameOrigin(req)) return apiError(403, "RW_AUTH_001", "Cross-origin request rejected");
  const user = await currentUser(req);
  if (user) await revokeSession(user.sessionId);
  return ok({ signed_out: true }, { headers: { "Set-Cookie": clearedSessionCookie() } });
});

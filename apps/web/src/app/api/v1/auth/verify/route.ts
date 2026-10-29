import { apiError, handle, ok, readJson, sameOrigin, trustedHost } from "@/server/http";
import { createSession, sessionCookie } from "@/server/session";
import { verifyChallenge } from "@/server/siwe";

export const POST = handle(async (req) => {
  const host = trustedHost(req);
  if (!host || !sameOrigin(req)) return apiError(403, "RW_AUTH_001", "Cross-origin sign-in rejected");
  const result = await verifyChallenge(await readJson(req), host);
  if (!result.ok) return apiError(401, "RW_AUTH_001", result.reason);
  const token = await createSession(result.userId);
  return ok({ address: result.address, new_user: result.created }, { headers: { "Set-Cookie": sessionCookie(token) } });
});

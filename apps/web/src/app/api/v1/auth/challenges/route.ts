import { apiError, handle, ok, readJson, trustedHost } from "@/server/http";
import { issueChallenge } from "@/server/siwe";

export const POST = handle(async (req) => {
  const host = trustedHost(req);
  if (!host) return apiError(400, "RW_AUTH_001", "Sign-in is not available on this host");
  const challenge = await issueChallenge(await readJson(req), host);
  return ok(challenge, { status: 201 });
});

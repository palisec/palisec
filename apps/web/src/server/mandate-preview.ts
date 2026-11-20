import "server-only";
import { HttpError } from "./http";
import { currentUser } from "./session";

/**
 * Phase 7 mandate pages and their public API stay preview-only until go-live:
 * until MANDATES_PUBLIC=1 is set, only a signed-in Palisec session can see or use them. Everyone else
 * gets "not found", so nothing about mandates is visible on the public site.
 */
export const mandatesPublic = () => process.env.MANDATES_PUBLIC === "1";

export async function requireMandatePreview(req: Request): Promise<void> {
  if (mandatesPublic()) return;
  if (!(await currentUser(req))) throw new HttpError(404, "PS_REQUEST_001", "Mandate not found");
}

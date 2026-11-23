import "server-only";
import { HttpError } from "./http";
import { currentUser } from "./session";

/**
 * Mandate pages and their public API. Public since 2026-11-21.
 * MANDATES_PUBLIC=0 is the switch to hide them again: then only a signed-in Palisec session can see or
 * use them, and everyone else gets "not found".
 */
export const mandatesPublic = () => process.env.MANDATES_PUBLIC !== "0";

export async function requireMandatesVisible(req: Request): Promise<void> {
  if (mandatesPublic()) return;
  if (!(await currentUser(req))) throw new HttpError(404, "PS_REQUEST_001", "Mandate not found");
}

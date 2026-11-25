import { classifyPolicyChange, type PolicyChange } from "./loosening";
import type { Policy } from "./types";

/**
 * Treasury guard lock (schema 1.6). While the version that decides today has a treasury guard locked
 * until a later time, no change may loosen that section: not through the API, the console or a holder
 * vote. Such a change is rejected with PS_TREASURY_005, never queued behind the loosening delay.
 * Tightening (a lower cap, fewer destinations, a later lock) applies at once. Returns the loosening
 * changes that break the lock, or null when the change may go ahead.
 */
export function treasuryLockViolation(before: Policy | null, after: Policy | null, now: number): PolicyChange[] | null {
  const g = before?.treasury_guard;
  if (!before || !g || g.enabled !== true || !(g.locked_until > now)) return null;
  if (!after) return [{ path: "$.treasury_guard", kind: "loosening", from: g, to: null, note: "treasury guard removed" }];
  const bad = classifyPolicyChange(before, after).changes.filter(
    (c) => c.kind === "loosening" && (c.path === "$" || c.path.startsWith("$.treasury_guard")),
  );
  return bad.length ? bad : null;
}

/** When the lock ends, as ISO 8601 UTC; null when the guard is off or not locked. */
export function treasuryLockedUntil(policy: Policy | null): string | null {
  const g = policy?.treasury_guard;
  return g?.enabled && g.locked_until > 0 ? new Date(g.locked_until * 1000).toISOString().replace(".000Z", "Z") : null;
}

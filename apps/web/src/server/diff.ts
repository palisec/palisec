/** Field-by-field differences between two JSON documents, as `$.path` → from / to. */
export interface Change {
  path: string;
  from: unknown;
  to: unknown;
}

export function diff(a: unknown, b: unknown, path = "$", out: Change[] = []): Change[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
  } else out.push({ path, from: a ?? null, to: b ?? null });
  return out;
}

/** Version and status always differ between a draft and an activated version; they are not policy changes. */
export const policyChanges = (from: unknown, to: unknown) => diff(from, to).filter((c) => c.path !== "$.version" && c.path !== "$.status");

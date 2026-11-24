import "server-only";
import canonicalize from "canonicalize";

export function toHex(buf: ArrayBuffer | Uint8Array) {
  return Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hex, not bytes, so the value passes through every database driver unchanged. */
export async function sha256Hex(input: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
}

export function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

/** JSON with object keys sorted, so equal documents hash equally whatever their key order. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value) ?? "";
}

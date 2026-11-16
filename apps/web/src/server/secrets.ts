import "server-only";
import { HttpError } from "./http";

/**
 * Encryption for the few secrets the server must use again later (webhook signing secrets), with
 * AES-256-GCM under PALISEC_SECRETS_KEY (32 random bytes, base64). Without the key these features
 * are unavailable rather than insecure. API keys are never stored this way: only their SHA-256.
 */

let cached: Promise<CryptoKey> | null = null;

export const secretsConfigured = () => keyBytes() !== null;

function keyBytes(): Uint8Array | null {
  const raw = process.env.PALISEC_SECRETS_KEY ?? "";
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(atob(raw.trim()), (c) => c.charCodeAt(0));
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

function key(): Promise<CryptoKey> {
  const bytes = keyBytes();
  if (!bytes) throw new HttpError(503, "PS_STATE_001", "Secret storage is not configured on this deployment (PALISEC_SECRETS_KEY)", false);
  cached ??= crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cached;
}

/** Returns nonce (12 bytes) || ciphertext+tag. */
export async function encryptSecret(plain: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function decryptSecret(blob: Uint8Array): Promise<string> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, await key(), blob.slice(12));
  return new TextDecoder().decode(pt);
}

/** HMAC-SHA256 hex, used to sign webhook bodies. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

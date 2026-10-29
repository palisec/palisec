import "server-only";

/**
 * Networks the control plane accepts. Only testnet is enabled: the mainnet chain ID comes from the
 * specification and has not been verified against a live RPC (spec §6.4).
 */
export const CHAINS = {
  46630: { name: "Robinhood Chain Testnet", rpc: process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com", enabled: true },
  4663: { name: "Robinhood Chain", rpc: process.env.RH_MAINNET_RPC_URL || "", enabled: false },
} as const;

export type ChainId = keyof typeof CHAINS;
export const VERIFY_CHAIN: ChainId = 46630;

export const databaseUrl = () => process.env.DATABASE_URL || "";
export const isDatabaseConfigured = () => databaseUrl() !== "";

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-rw_session" : "rw_session";

/**
 * Hosts a sign-in message may be bound to. The SIWE domain is taken from this list, never from an
 * unchecked Host header, so a phishing origin cannot obtain a message naming ours.
 */
export function allowedHosts(): string[] {
  const hosts = new Set<string>();
  const add = (v?: string) => {
    if (!v) return;
    try {
      hosts.add(new URL(v.includes("://") ? v : `https://${v}`).host);
    } catch {
      // Ignore malformed configuration rather than widening the allowlist.
    }
  };
  // The canonical domain's apex and www forms are both ours, whichever one the host makes primary.
  for (const v of [process.env.NEXT_PUBLIC_SITE_URL, process.env.RAILWAY_PUBLIC_DOMAIN, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    add(v);
    if (!v || /(vercel|railway)\.app/.test(v)) continue;
    try {
      const host = new URL(v.includes("://") ? v : `https://${v}`).hostname;
      add(host.startsWith("www.") ? host.slice(4) : `www.${host}`);
    } catch {
      // Malformed: already ignored by add().
    }
  }
  add(process.env.VERCEL_URL);
  add(process.env.VERCEL_BRANCH_URL);
  for (const h of (process.env.PALISEC_EXTRA_HOSTS || "").split(",")) add(h.trim());
  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:3000");
    hosts.add("127.0.0.1:3000");
  }
  return [...hosts];
}

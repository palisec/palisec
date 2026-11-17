import "server-only";
import { isNetworkId, MAINNET, NETWORKS, TESTNET, type NetworkId } from "@/lib/networks";
import { SITE_URL } from "@/lib/site";

/**
 * Networks the control plane accepts. Testnet is always on. Mainnet (real funds) is on only when the
 * operator sets PALISEC_MAINNET=enabled; until then mainnet requests are refused with PS_CHAIN_001.
 * Chain 4663 was verified against Robinhood's public RPC (eth_chainId 0x1237) on 2026-11-18.
 */
export const mainnetEnabled = () => (process.env.PALISEC_MAINNET || "").trim().toLowerCase() === "enabled";

/** Server-side RPC: an explicit override, else Alchemy when a key is set, else the public endpoint. */
function rpcFor(id: NetworkId, override: string | undefined): string {
  if (override?.trim()) return override.trim();
  const key = (process.env.ALCHEMY_API_KEY || "").trim();
  if (/^[A-Za-z0-9_-]{8,128}$/.test(key)) return `https://${NETWORKS[id].alchemy}.g.alchemy.com/v2/${key}`;
  return NETWORKS[id].publicRpc;
}

export const CHAINS: Record<NetworkId, { name: string; rpc: string; enabled: boolean; testnet: boolean }> = {
  [MAINNET]: { name: NETWORKS[MAINNET].name, rpc: rpcFor(MAINNET, process.env.RH_MAINNET_RPC_URL), enabled: mainnetEnabled(), testnet: false },
  [TESTNET]: { name: NETWORKS[TESTNET].name, rpc: rpcFor(TESTNET, process.env.RH_TESTNET_RPC_URL), enabled: true, testnet: true },
};

export type ChainId = NetworkId;
/** Sign-in messages name testnet; the chain only matters for verifying smart-contract wallet signatures. */
export const VERIFY_CHAIN: ChainId = TESTNET;

export const chainEnabled = (id: number): id is ChainId => isNetworkId(id) && CHAINS[id].enabled;
export const enabledChainIds = (): ChainId[] => ([MAINNET, TESTNET] as const).filter((id) => CHAINS[id].enabled);
/** The network new agents and policies start on: mainnet when it is on, otherwise testnet. */
export const defaultChain = (): ChainId => (CHAINS[MAINNET].enabled ? MAINNET : TESTNET);

export const databaseUrl = () => process.env.DATABASE_URL || "";
export const isDatabaseConfigured = () => databaseUrl() !== "";

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
export const CHALLENGE_TTL_SECONDS = 5 * 60;
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-ps_session" : "ps_session";

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
  // The canonical domain's apex and www forms are both ours.
  add(SITE_URL);
  const apex = new URL(SITE_URL).host.replace(/^www\./, "");
  add(apex);
  add(`www.${apex}`);
  // Vercel deployment and branch URLs, so preview deployments can be tested. Vercel sets these.
  add(process.env.VERCEL_URL);
  add(process.env.VERCEL_BRANCH_URL);
  for (const h of (process.env.PALISEC_EXTRA_HOSTS || "").split(",")) add(h.trim());
  if (process.env.NODE_ENV !== "production") {
    hosts.add("localhost:3000");
    hosts.add("127.0.0.1:3000");
  }
  return [...hosts];
}

import "server-only";
import { fallback, http, type Transport } from "viem";
import { isNetworkId, MAINNET, NETWORKS, TESTNET, type NetworkId } from "@/lib/networks";
import { SITE_URL } from "@/lib/site";

/**
 * Networks the control plane accepts. Mainnet (4663, real funds) is the primary network and is on unless
 * the operator sets PALISEC_MAINNET=off, which refuses every mainnet request with PS_CHAIN_001. Testnet
 * (46630) is always on for trying things out. Chain 4663 verified against Robinhood's RPC on 2026-11-18.
 */
export const mainnetEnabled = () => !["off", "disabled", "false", "0"].includes((process.env.PALISEC_MAINNET || "").trim().toLowerCase());

/**
 * Server-side RPCs, in order: an explicit override alone (tests point it at a local fork), otherwise
 * Alchemy when a key is set with the public endpoint as fallback, otherwise the public endpoint.
 */
function rpcsFor(id: NetworkId, override: string | undefined): string[] {
  if (override?.trim()) return [override.trim()];
  const key = alchemyKey(id);
  if (key) return [`https://${NETWORKS[id].alchemy}.g.alchemy.com/v2/${key}`, NETWORKS[id].publicRpc];
  return [NETWORKS[id].publicRpc];
}

/**
 * The Alchemy key for one network: ALCHEMY_MAINNET_API_KEY or ALCHEMY_TESTNET_API_KEY when set, so each
 * network can have its own credential; otherwise the shared ALCHEMY_API_KEY. The network is always
 * chosen by the URL built from it, never by the key.
 */
export function alchemyKey(id: NetworkId): string | null {
  const own = id === MAINNET ? process.env.ALCHEMY_MAINNET_API_KEY : process.env.ALCHEMY_TESTNET_API_KEY;
  const key = ((own ?? "").trim() || (process.env.ALCHEMY_API_KEY || "").trim());
  return /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : null;
}

export const CHAINS: Record<NetworkId, { name: string; rpcs: string[]; enabled: boolean; testnet: boolean }> = {
  [MAINNET]: { name: NETWORKS[MAINNET].name, rpcs: rpcsFor(MAINNET, process.env.RH_MAINNET_RPC_URL), enabled: mainnetEnabled(), testnet: false },
  [TESTNET]: { name: NETWORKS[TESTNET].name, rpcs: rpcsFor(TESTNET, process.env.RH_TESTNET_RPC_URL), enabled: true, testnet: true },
};

/** A viem transport for a network: the first RPC, falling back to the next if it errors or times out. */
export function chainTransport(id: NetworkId, timeout = 8000): Transport {
  const list = CHAINS[id].rpcs.map((u) => http(u, { timeout, retryCount: 1 }));
  return list.length === 1 ? list[0]! : fallback(list);
}

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

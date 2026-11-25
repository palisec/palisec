/**
 * The networks Palisec knows, as published in Robinhood's "Connecting to Robinhood Chain" page.
 * Public facts only, safe for the browser. Which of them a deployment accepts is server configuration
 * (server/config.ts): testnet always, mainnet only when the operator turns it on.
 */

export const MAINNET = 4663;
export const TESTNET = 46630;
export type NetworkId = typeof MAINNET | typeof TESTNET;

export interface Network {
  chainId: NetworkId;
  name: string;
  /** One word for tight places: "Mainnet" or "Testnet". */
  short: string;
  testnet: boolean;
  /** Public, rate-limited RPC: fine for a wallet, not for the server (which uses Alchemy when it can). */
  publicRpc: string;
  explorer: string;
  /** Alchemy's network slug, used for the server's RPC and the ERC-4337 bundler. */
  alchemy: string;
}

export const NETWORKS: Record<NetworkId, Network> = {
  [MAINNET]: {
    chainId: MAINNET,
    name: "Robinhood Chain",
    short: "Mainnet",
    testnet: false,
    publicRpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    alchemy: "robinhood-mainnet",
  },
  [TESTNET]: {
    chainId: TESTNET,
    name: "Robinhood Chain Testnet",
    short: "Testnet",
    testnet: true,
    publicRpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    alchemy: "robinhood-testnet",
  },
};

export const isNetworkId = (v: unknown): v is NetworkId => v === MAINNET || v === TESTNET;

export function network(chainId: number): Network | null {
  return isNetworkId(chainId) ? NETWORKS[chainId] : null;
}

/** "Robinhood Chain · 4663", or the bare number for a chain Palisec does not support. */
export function networkLabel(chainId: number, style: "long" | "short" = "long"): string {
  const n = network(chainId);
  if (!n) return `Chain ${chainId}`;
  return `${style === "long" ? n.name : n.short} · ${n.chainId}`;
}

/** Parameters for wallet_addEthereumChain, so a browser wallet can add the network in one prompt. */
export function walletChainParams(chainId: NetworkId) {
  const n = NETWORKS[chainId];
  return {
    chainId: `0x${n.chainId.toString(16)}`,
    chainName: n.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [n.publicRpc],
    blockExplorerUrls: [n.explorer],
  };
}

export const explorerAddress = (chainId: number, address: string) => {
  const n = network(chainId);
  return n ? `${n.explorer}/address/${address}` : null;
};
export const explorerTx = (chainId: number, hash: string) => {
  const n = network(chainId);
  return n ? `${n.explorer}/tx/${hash}` : null;
};

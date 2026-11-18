"use client";

/**
 * The browser wallet the member signed in with. Several wallet extensions can be installed at once and
 * only one of them owns `window.ethereum`, so the console must use the extension chosen at sign-in
 * (EIP-6963 discovery), not whichever extension happens to own `window.ethereum`.
 */

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}
export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns?: string;
  provider: Eip1193;
}

const KEY = "ps_wallet";

/** Remembers the chosen extension (its reverse-DNS id or name; never an address or key). */
export function rememberWallet(w: Pick<WalletInfo, "rdns" | "name">) {
  try {
    localStorage.setItem(KEY, w.rdns || w.name);
  } catch {
    // Storage blocked: the console falls back to the default wallet and still checks the account.
  }
}

/** Collects every wallet that announces itself within `ms`. */
export function discoverWallets(ms = 400): Promise<WalletInfo[]> {
  return new Promise((resolve) => {
    const found = new Map<string, WalletInfo>();
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { info?: { uuid: string; name: string; icon: string; rdns?: string }; provider?: Eip1193 };
      if (d?.info?.uuid && d.provider && !found.has(d.info.uuid)) found.set(d.info.uuid, { ...d.info, provider: d.provider });
    };
    window.addEventListener("eip6963:announceProvider", on);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", on);
      resolve([...found.values()]);
    }, ms);
  });
}

/** The wallet chosen at sign-in, else the only announced one, else `window.ethereum`. */
export async function signedInWallet(): Promise<{ provider: Eip1193; name: string } | null> {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    saved = null;
  }
  const list = await discoverWallets(300);
  const match = (saved && list.find((w) => (w.rdns || w.name) === saved)) || (list.length === 1 ? list[0] : null);
  if (match) return { provider: match.provider, name: match.name };
  const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  return injected ? { provider: injected, name: "your browser wallet" } : null;
}

/**
 * Connects the signed-in wallet and checks it is using the signed-in account, so a transaction or
 * signature never comes from a different address than the one the member sees in the console.
 */
export async function connectAs(expected: string): Promise<{ eth: Eip1193; from: string; name: string }> {
  const w = await signedInWallet();
  if (!w) throw new Error("No browser wallet found. Install MetaMask or another wallet.");
  const accounts = ((await w.provider.request({ method: "eth_requestAccounts" })) as string[]) ?? [];
  const from = accounts.find((a) => a.toLowerCase() === expected.toLowerCase());
  if (!from) {
    const shown = accounts[0] ? `${accounts[0].slice(0, 6)}…${accounts[0].slice(-4)}` : "no account";
    throw new Error(
      `${w.name} is using ${shown}, but you are signed in as ${expected.slice(0, 6)}…${expected.slice(-4)}. Switch to that account in ${w.name}, or sign out and sign in with the account you want. Nothing was sent.`,
    );
  }
  return { eth: w.provider, from, name: w.name };
}

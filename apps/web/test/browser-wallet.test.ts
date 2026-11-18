import assert from "node:assert/strict";
import { describe, it } from "node:test";

// A minimal browser: two wallet extensions announce themselves (EIP-6963); "Other" owns window.ethereum.
const store = new Map<string, string>();
const bus = new EventTarget();
const wallet = (name: string, rdns: string, accounts: string[]) => ({ info: { uuid: rdns, name, icon: "", rdns }, provider: { request: async ({ method }: { method: string }) => (method === "eth_requestAccounts" ? accounts : null) } });
const metamask = wallet("MetaMask", "io.metamask", ["0x989Ef00000000000000000000000000000001c430"]);
const other = wallet("Other", "com.other", ["0xf4b3000000000000000000000000000000000e6CA"]);
bus.addEventListener("eip6963:requestProvider", () => {
  for (const w of [metamask, other]) bus.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: w }));
});
Object.assign(globalThis, {
  window: { addEventListener: bus.addEventListener.bind(bus), removeEventListener: bus.removeEventListener.bind(bus), dispatchEvent: bus.dispatchEvent.bind(bus), ethereum: other.provider },
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
});
const { connectAs, rememberWallet, signedInWallet } = await import("../src/lib/browser-wallet.ts");

describe("the console uses the wallet chosen at sign-in", () => {
  it("picks the remembered extension, not the one that owns window.ethereum", async () => {
    rememberWallet({ rdns: "io.metamask", name: "MetaMask" });
    assert.equal((await signedInWallet())?.name, "MetaMask");
    const c = await connectAs("0x989ef00000000000000000000000000000001C430");
    assert.equal(c.name, "MetaMask");
    assert.equal(c.from, "0x989Ef00000000000000000000000000000001c430");
  });
  it("refuses, sending nothing, when the wallet's account is not the signed-in one", async () => {
    rememberWallet({ rdns: "io.metamask", name: "MetaMask" });
    await assert.rejects(connectAs("0xf4b3000000000000000000000000000000000e6CA"), /MetaMask is using 0x989E…c430, but you are signed in as 0xf4b3…e6CA.*Nothing was sent/);
  });
});

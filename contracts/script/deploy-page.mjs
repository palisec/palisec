#!/usr/bin/env node
/**
 * Writes a one-file page that deploys PalisecCredits from the browser wallet (MetaMask): the owner
 * only confirms the transaction; no private key is ever typed or stored. The connected wallet becomes
 * admin and treasury unless ADMIN / TREASURY are given (both can be moved later: proposeAdmin, setTreasury).
 *
 *   forge build && node script/deploy-page.mjs <out.html>
 *   serve the folder (any static server on localhost) and open the page in the browser with the wallet
 */
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "deploy-credits.html";
const art = JSON.parse(readFileSync(new URL("../out/PalisecCredits.sol/PalisecCredits.json", import.meta.url), "utf8"));
const bytecode = art.bytecode.object;
const cfg = {
  chainId: 4663,
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  palisec: "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB",
  ethUsd: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
  admin: process.env.ADMIN ?? "",
  treasury: process.env.TREASURY ?? "",
  // Plan values: $5 per 1,000; 20% off in PALISEC; $10 / $25 caps; $1,000 per USDG/ETH purchase;
  // ETH/USD at most 25 h old (Chainlink heartbeat 24 h); no sequencer uptime feed is published for this chain yet.
  words: [5_000_000, 2_000, 10_000_000, 25_000_000, 1_000_000_000, 90_000, 3_600],
  sequencer: "0x0000000000000000000000000000000000000000",
};

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Deploy PalisecCredits</title>
<style>body{font:15px system-ui;background:#011d1c;color:#edfffe;max-width:720px;margin:40px auto;padding:0 16px}button{font:inherit;padding:10px 16px;border-radius:6px;border:0;background:#9cf6ee;color:#012624;cursor:pointer}code,pre{font:12px ui-monospace,monospace;color:#cbfffc;white-space:pre-wrap;word-break:break-all}</style>
<h1>Deploy PalisecCredits on Robinhood Chain mainnet</h1>
<p>Click the button, then confirm the transaction in your wallet. Gas is about 2,000,000 at ~0.02 gwei (≈0.00004 ETH).</p>
<p>Admin: <code id="admin">${cfg.admin || "the connected wallet"}</code><br>Treasury: <code id="treasury">${cfg.treasury || "the connected wallet"}</code></p>
<button id="go">Connect wallet and deploy</button>
<pre id="log"></pre>
<script>
const BYTECODE = "${bytecode}";
const CFG = ${JSON.stringify(cfg)};
const log = (m) => (document.getElementById("log").textContent += m + "\\n");
const word = (v) => (typeof v === "string" ? v.toLowerCase().replace(/^0x/, "").padStart(64, "0") : BigInt(v).toString(16).padStart(64, "0"));
document.getElementById("go").onclick = async () => {
  try {
    const eth = window.ethereum;
    if (!eth) throw new Error("No browser wallet found.");
    const [from] = await eth.request({ method: "eth_requestAccounts" });
    try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] }); }
    catch (e) { if (e.code !== 4902) throw e; await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x1237", chainName: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"] }] }); }
    if (Number(await eth.request({ method: "eth_chainId" })) !== CFG.chainId) throw new Error("Wallet is not on Robinhood Chain mainnet.");
    const admin = CFG.admin || from, treasury = CFG.treasury || from;
    const args = [CFG.usdg, CFG.palisec, CFG.ethUsd, admin, treasury, ...CFG.words, CFG.sequencer].map(word).join("");
    log("Deploying from " + from + " (admin " + admin + ", treasury " + treasury + ")…");
    const tx = await eth.request({ method: "eth_sendTransaction", params: [{ from, data: BYTECODE + args }] });
    log("Transaction: " + tx);
    for (let i = 0; i < 90; i++) {
      const r = await eth.request({ method: "eth_getTransactionReceipt", params: [tx] });
      if (r) {
        if (r.status !== "0x1") throw new Error("Deployment reverted.");
        log("DEPLOYED " + r.contractAddress + " block " + Number(r.blockNumber));
        document.title = "DEPLOYED " + r.contractAddress + " " + Number(r.blockNumber);
        return;
      }
      await new Promise((s) => setTimeout(s, 2000));
    }
    log("No receipt yet; check the transaction on the explorer.");
  } catch (e) { log("Error: " + (e.message || e)); }
};
</script>`);
console.log(`wrote ${out}`);

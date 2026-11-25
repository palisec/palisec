#!/usr/bin/env node
/**
 * Builds the command menu's index (src/generated/search-index.json) from the navigation, every docs page's
 * title and h2/h3 headings, the reason codes, the contract addresses and the public demo accounts. The menu
 * runs fully in the browser with this file; nothing is fetched. Run by `pnpm build`; `--check` fails when the
 * committed file is out of date.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(web, "../..");
const out = path.join(web, "src/generated/search-index.json");

const items = [];
const add = (kind, title, href, extra = {}) => items.push({ kind, title, href, ...extra });

// Navigation.
for (const [title, href] of [
  ["Home", "/"], ["Accounts", "/accounts"], ["Limits", "/limits"], ["Mandates", "/mandates"], ["Palisec Agent", "/agent"],
  ["Architecture", "/architecture"], ["Security", "/security"], ["Pricing", "/pricing"], ["Standard (ERC-8511)", "/standard"],
  ["Proof", "/proof"], ["Ecosystem", "/ecosystem"], ["Token", "/token"], ["Developers", "/developers"], ["Docs", "/docs"],
  ["Status", "/status"], ["Changelog", "/changelog"], ["Attestation", "/attestation"], ["Console", "/console"],
]) add("page", title, href);
for (const [w, id] of [["Spend", "spend"], ["Loss", "loss"], ["Approve", "approve"], ["Simulate", "simulate"], ["Assets", "assets"], ["Delay", "delay"], ["Stop", "stop"]]) {
  add("page", `Limits · ${w}`, `/limits#${id}`);
}

// Docs pages: title and h2/h3 headings (with their ids when present).
const docsDir = path.join(web, "src/app/(site)/docs");
const clean = (s) => s.replace(/\{["'`]([^"'`]*)["'`]\}/g, "$1").replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
function walk(dir, prefix) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}/${e.name}`);
    else if (e.name === "page.tsx") {
      const src = readFileSync(path.join(dir, e.name), "utf8");
      const href = `/docs${prefix}`;
      const title = src.match(/title:\s*"([^"]+)"/)?.[1] ?? href;
      add("doc", title, href);
      for (const m of src.matchAll(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/g)) {
        const text = clean(m[3]);
        if (!text || text.length > 90 || text.includes("{")) continue;
        const id = m[2].match(/id="([^"]+)"/)?.[1];
        add("heading", text, id ? `${href}#${id}` : href, { parent: title });
      }
      for (const m of src.matchAll(/<(?:DocSection|Section)[^>]*\btitle="([^"]+)"[^>]*?(?:id="([^"]+)")?/g)) {
        add("heading", clean(m[1]), m[2] ? `${href}#${m[2]}` : href, { parent: title });
      }
    }
  }
}
walk(docsDir, "");

// Reason codes.
const codes = readFileSync(path.join(repo, "packages/policy-schema/src/codes.ts"), "utf8");
const block = codes.slice(codes.indexOf("REASON_CODES = {"), codes.indexOf("} as const"));
for (const m of block.matchAll(/(PS_[A-Z]+_\d{3}):\s*"([^"]+)"/g)) add("code", m[1], `/docs/errors#${m[1]}`, { detail: m[2] });

// Contract addresses and the public demo accounts.
const manifest = JSON.parse(readFileSync(path.join(repo, "deployments/robinhood-mainnet.json"), "utf8"));
for (const c of [...manifest.palisec_deployed_contracts, ...manifest.contracts]) add("address", c.name, null, { address: c.address });
add("address", "$PALISEC token", null, { address: "0x1B4d04c8A67bf98BdF791EF928482bcB225d71AB" });
add("address", "Demo · loss and spend limits", null, { address: "0x667729a0E035332F63e69626CD7A97863C49fD77" });
add("address", "Demo · holder mandates", null, { address: "0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c" });

// De-duplicate by kind + title + href.
const seen = new Set();
const index = items.filter((i) => {
  const k = `${i.kind}|${i.title}|${i.href ?? i.address}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
const json = `${JSON.stringify(index, null, 1)}\n`;

if (process.argv.includes("--check")) {
  const now = existsSync(out) ? readFileSync(out, "utf8").replace(/\r\n/g, "\n") : "";
  if (now !== json) { console.error("search index is out of date: run node apps/web/scripts/build-search-index.mjs"); process.exit(1); }
  console.log(`search index up to date (${index.length} entries)`);
} else {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, json);
  console.log(`search index: ${index.length} entries`);
}

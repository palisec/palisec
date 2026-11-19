#!/usr/bin/env node
/**
 * Phase 6: one tiny real swap through the PALISEC smart account, with asset safety on.
 * 0.00025 ETH -> USDG on Uniswap v3 (SwapRouter02, 0.01% pool); the USDG returns to the smart account.
 *
 *   node smoke-swap.mjs           preview: quote, Palisec dry run with the asset check, amount and gas. Sends nothing.
 *   node smoke-swap.mjs --send    records the decision, signs with the agent key, PALISEC co-signs, executes.
 *
 * Same inputs as smoke-live.mjs / smoke-flows.mjs (agent API key and agent key with hidden input, never
 * printed or saved; smart account address). This is flow S of smoke-flows.mjs.
 */
if (!process.argv.includes("--flow")) process.argv.push("--flow", "S");
await import("./smoke-flows.mjs");

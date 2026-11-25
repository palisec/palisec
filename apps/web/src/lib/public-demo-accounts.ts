/**
 * The public demo accounts on Robinhood Chain mainnet (4663). Public endpoints (/api/v1/public/proof,
 * /registry) read only these; nothing else from any organization is ever returned.
 *
 * The loss-limits demo also runs the token spend limits (policy schema 1.5).
 */
export const PUBLIC_DEMO_ACCOUNTS = [
  { account: "0x667729a0E035332F63e69626CD7A97863C49fD77", label: "demo · loss and spend limits", key: "limits" },
  { account: "0x9aEC761B2F0FdA08C683e8388478C9A2F7C9170c", label: "demo · holder mandates", key: "mandates" },
] as const;

export const PUBLIC_DEMO_CHAIN = 4663;

export function demoLabel(account: string): string | null {
  const a = account.toLowerCase();
  return PUBLIC_DEMO_ACCOUNTS.find((d) => d.account.toLowerCase() === a)?.label ?? null;
}

"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "../icons";
import { PALISEC_CA } from "../ca-chip";

/** Rounded pill with the $PALISEC tag and the short address; copies the full address. */
export function AddressChip({ address = PALISEC_CA, tag = "$PALISEC" }: { address?: string; tag?: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused: nothing to show */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${tag} ${short}: copy the contract address ${address}`}
      className="inline-flex h-9 items-center gap-2.5 rounded-full border border-line-strong pl-1.5 pr-3 font-mono text-[0.8125rem] text-silver transition-colors hover:border-aqua/50 hover:text-mist"
    >
      <span className="rounded-full bg-aqua/10 px-2 py-0.5 text-[0.6875rem] text-aqua">{tag}</span>
      <span className="tabular-nums">{short}</span>
      {copied ? <span className="inline-flex items-center gap-1 text-aqua"><CheckIcon size={13} /> Copied</span> : <CopyIcon size={13} />}
    </button>
  );
}

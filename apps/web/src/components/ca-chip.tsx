"use client";

import { useState } from "react";
import { AlertIcon, CheckIcon, CopyIcon } from "./icons";

/** The one official PALISEC contract address. */
export const PALISEC_CA = "0x1b4d04c8a67bf98bdf791ef928482bcb225d71ab";
const SHORT = `${PALISEC_CA.slice(0, 6)}…${PALISEC_CA.slice(-4)}`;

/** Header chip: one click copies the full contract address. */
export function CaChip({ className = "" }: { className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(PALISEC_CA);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1800);
  }

  const tone = state === "copied" ? "text-aqua shadow-[inset_0_0_0_1px_rgb(156_246_238/0.5)]" : state === "failed" ? "text-deny shadow-[inset_0_0_0_1px_rgb(255_122_140/0.5)]" : "text-silver shadow-[inset_0_0_0_1px_var(--color-line-strong)]";

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy the PALISEC contract address ${PALISEC_CA}`}
      title={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : `Copy CA: ${PALISEC_CA}`}
      className={`group inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 transition-[color,box-shadow,background-color] duration-300 hover:bg-raised/60 hover:text-aqua hover:shadow-[inset_0_0_0_1px_rgb(156_246_238/0.5)] focus-visible:text-aqua active:scale-[0.97] ${tone} ${className}`}
    >
      <span className="font-utility text-[12px] font-semibold tracking-[0.04em] text-aqua">CA</span>
      <span className="hidden font-mono text-[12.5px] text-mist sm:inline xl:hidden 2xl:inline">{SHORT}</span>
      <span key={state} aria-hidden className="animate-[c-pop_.28s_var(--ease-out-quint)]">
        {state === "copied" ? <CheckIcon size={15} /> : state === "failed" ? <AlertIcon size={15} /> : <CopyIcon size={15} />}
      </span>
      <span aria-live="polite" className="sr-only">{state === "copied" ? "Contract address copied" : state === "failed" ? "Copy failed" : ""}</span>
    </button>
  );
}

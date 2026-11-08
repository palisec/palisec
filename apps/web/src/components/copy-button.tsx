"use client";

import { useState } from "react";
import { AlertIcon, CheckIcon, CopyIcon } from "./icons";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[4px] border bg-abyss transition-colors active:scale-[0.94] ${
        state === "copied" ? "border-aqua/60 text-aqua" : state === "failed" ? "border-deny/60 text-deny" : "border-line-strong text-silver hover:border-aqua hover:text-aqua"
      }`}
    >
      <span key={state} className="animate-[c-pop_.28s_var(--ease-out-quint)]">
        {state === "copied" ? <CheckIcon size={14} /> : state === "failed" ? <AlertIcon size={14} /> : <CopyIcon size={14} />}
      </span>
      <span aria-live="polite" className="sr-only">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : ""}</span>
    </button>
  );
}

/** Code block with filename/language header and a copy control. */
export function CodeBlock({ code, title, lang, pseudo = false }: { code: string; title?: string; lang?: string; pseudo?: boolean }) {
  return (
    <div className="panel my-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-[linear-gradient(180deg,rgb(237_255_254/0.03),transparent)] px-3 py-1.5">
        <span aria-hidden className="mr-1 flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-aqua/70 shadow-[0_0_6px_#9cf6ee]" />
        </span>
        <p className="label !mb-0 mr-auto flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{title ?? lang}</span>
          {pseudo && <span className="min-w-0 !text-lilac">◆ pseudocode · not yet runnable</span>}
        </p>
        <CopyButton text={code} label={`Copy ${title ?? "code"}`} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-[1.75] text-soft">
        <code>{code}</code>
      </pre>
    </div>
  );
}

"use client";

import { useState } from "react";

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
      className="rounded-[4px] border border-line-strong bg-carbon px-2 py-1 font-utility text-[9.5px] tracking-[0.08em] text-stone transition-colors hover:border-citrine hover:text-citrine"
    >
      <span aria-live="polite" className={state === "copied" ? "text-citrine" : ""}>{state === "copied" ? "COPIED" : state === "failed" ? "FAILED" : "COPY"}</span>
    </button>
  );
}

/** Code block with filename/language header and a copy control. */
export function CodeBlock({ code, title, lang, pseudo = false }: { code: string; title?: string; lang?: string; pseudo?: boolean }) {
  return (
    <div className="panel my-6 overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-line bg-[linear-gradient(180deg,rgb(255_255_240/0.03),transparent)] px-3 py-1.5">
        <span aria-hidden className="mr-1 flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-citrine/70 shadow-[0_0_6px_#e5ff5d]" />
        </span>
        <p className="label !mb-0 mr-auto flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{title ?? lang}</span>
          {pseudo && <span className="min-w-0 !text-sand">◆ pseudocode · not yet runnable</span>}
        </p>
        <CopyButton text={code} label={`Copy ${title ?? "code"}`} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-[1.75] text-soft">
        <code>{code}</code>
      </pre>
    </div>
  );
}

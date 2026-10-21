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
      className="rounded-[4px] border border-graphite bg-carbon px-2 py-1 text-[10px] font-medium tracking-[0.08em] text-stone transition-colors hover:border-citrine hover:text-citrine"
    >
      <span aria-live="polite" className={state === "copied" ? "text-citrine" : ""}>{state === "copied" ? "COPIED" : state === "failed" ? "FAILED" : "COPY"}</span>
    </button>
  );
}

/** Code block with filename/language header and a copy control. */
export function CodeBlock({ code, title, lang, pseudo = false }: { code: string; title?: string; lang?: string; pseudo?: boolean }) {
  return (
    <div className="my-6 overflow-hidden rounded-[12px] border border-graphite bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-1.5">
        <p className="label truncate">
          {title ?? lang}
          {pseudo && <span className="ml-2 !text-sand">· pseudocode · not yet runnable</span>}
        </p>
        <CopyButton text={code} label={`Copy ${title ?? "code"}`} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-soft">
        <code>{code}</code>
      </pre>
    </div>
  );
}

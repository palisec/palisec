"use client";

export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-[60ch] py-10">
      <p className="font-mono text-xs tracking-[0.08em] text-deny">■ CONSOLE ERROR</p>
      <h1 className="mt-3 font-heading text-[26px] font-bold text-bone">This screen failed to render.</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        No authorization state changed: the simulation only updates after an action completes. Try again, or reset the workspace from the side panel.
      </p>
      <button type="button" onClick={reset} className="btn btn-ghost mt-6">Try again</button>
    </div>
  );
}

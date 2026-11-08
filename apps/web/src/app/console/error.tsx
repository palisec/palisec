"use client";

export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-[60ch] py-10">
      <p className="font-mono text-xs tracking-[0.08em] text-deny">■ CONSOLE ERROR</p>
      <h1 className="mt-3 font-heading text-[26px] font-medium tracking-[-0.02em] text-mist">This screen failed to render.</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Nothing was changed by this error: every action is confirmed by the server before the screen updates. Try again, or reload the page.
      </p>
      <button type="button" onClick={reset} className="btn btn-ghost mt-6">Try again</button>
    </div>
  );
}

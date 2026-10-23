/** Route-level loading state: the shell stays put while the screen streams in. */
export default function ConsoleLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading</span>
      <div className="c-shimmer h-7 w-56 rounded-[4px]" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="c-shimmer h-28 rounded-[12px]" style={{ animationDelay: `${i * 120}ms` }} />)}
      </div>
      <div className="c-shimmer h-64 rounded-[12px]" />
    </div>
  );
}

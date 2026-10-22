/** Route-level loading state: the shell stays put while the screen streams in. */
export default function ConsoleLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading</span>
      <div className="h-7 w-56 animate-pulse rounded-[4px] bg-raised" />
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-[12px] bg-surface" />)}
      </div>
      <div className="h-64 animate-pulse rounded-[12px] bg-surface" />
    </div>
  );
}

/** Route-level loading state for the public site. */
export default function SiteLoading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-[1280px] px-4 pb-24 pt-28 sm:px-8">
      <span className="sr-only">Loading</span>
      <div className="h-3 w-32 animate-pulse rounded-[2px] bg-raised" />
      <div className="mt-8 h-16 w-3/4 max-w-[720px] animate-pulse rounded-[4px] bg-raised" />
      <div className="mt-4 h-16 w-1/2 max-w-[480px] animate-pulse rounded-[4px] bg-raised" />
      <div className="mt-10 h-4 w-full max-w-[560px] animate-pulse rounded-[2px] bg-surface" />
    </div>
  );
}

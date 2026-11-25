/** Route-level loading state for the public site. */
export default function SiteLoading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto flex min-h-[80vh] w-full max-w-[92.5rem] flex-col justify-center px-4 pb-24 pt-28 sm:px-8">
      <span className="sr-only">Loading</span>
      <div className="h-3 w-32 c-shimmer rounded-[2px]" />
      <div className="mt-8 h-16 w-3/4 max-w-[45rem] c-shimmer rounded-[0.25rem]" />
      <div className="mt-4 h-16 w-1/2 max-w-[30rem] c-shimmer rounded-[0.25rem]" />
      <div className="mt-10 h-4 w-full max-w-[35rem] c-shimmer rounded-[2px]" />
    </div>
  );
}

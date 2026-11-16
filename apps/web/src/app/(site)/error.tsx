"use client";

import { Container } from "@/components/ui";

export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Container className="flex min-h-[60vh] flex-col justify-center py-16">
      <p className="font-utility text-[13px] font-semibold text-deny">This page failed to render</p>
      <h1 className="mt-4 text-3xl font-medium tracking-[-0.03em] text-fg">This page failed to load.</h1>
      <button type="button" onClick={reset} className="mt-8 h-10 w-fit border border-line-strong px-4 text-sm text-fg hover:border-fg">
        Try again
      </button>
    </Container>
  );
}

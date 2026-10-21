"use client";

import { useEffect, useState, type ReactNode } from "react";

/** Transparent at the top of the page; gains a carbon panel once scrolled. */
export function NavShell({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      className={`mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-6 rounded-[8px] border px-4 transition-all duration-500 sm:px-6 ${
        scrolled ? "border-graphite bg-carbon/85 backdrop-blur-md" : "border-transparent bg-transparent"
      }`}
    >
      {children}
    </div>
  );
}

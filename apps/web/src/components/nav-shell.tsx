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
      className={`mx-auto flex h-16 w-full max-w-[1384px] items-center justify-between gap-6 rounded-[10px] px-4 transition-all duration-500 ease-[var(--ease-out-quint)] sm:px-6 ${
        scrolled
          ? "bg-[linear-gradient(180deg,rgb(0_55_52/0.82),rgb(1_38_36/0.82))] shadow-[inset_0_0_0_1px_var(--color-line-strong),inset_0_1px_0_rgb(237_255_254/0.08),0_18px_40px_-20px_rgb(0_0_0/0.9)] backdrop-blur-xl backdrop-saturate-150"
          : "bg-transparent shadow-[inset_0_0_0_1px_transparent]"
      }`}
    >
      {children}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Docs sidebar link that marks the page you are on. */
export function DocsNavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`-ml-px flex items-center gap-2 border-l py-1 pl-3 text-[13px] transition-colors ${
        active ? "border-citrine text-bone" : "border-transparent text-muted hover:border-fg hover:text-fg"
      }`}
    >
      <span aria-hidden className={`h-1 w-1 ${active ? "bg-citrine shadow-[0_0_6px_#e5ff5d]" : "bg-transparent"}`} />
      {children}
    </Link>
  );
}

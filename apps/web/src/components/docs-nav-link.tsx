"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Docs sidebar link: the current page is aqua with a 2 px aqua bar on its left. */
export function DocsNavLink({ href, children }: { href: string; children: ReactNode }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block border-l-2 py-1.5 pl-3 text-[0.9062rem] transition-colors ${
        active ? "border-aqua text-aqua" : "border-transparent text-silver hover:text-mist"
      }`}
    >
      {children}
    </Link>
  );
}

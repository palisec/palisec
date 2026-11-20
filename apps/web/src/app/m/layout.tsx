import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";

/** Public mandate pages: a plain frame (no session, nothing personal), outside the site's interactive header. */
export default function MandateLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-abyss">
      <header className="flex items-center justify-between border-b border-line px-6 py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <BrandMark size={22} />
          <span className="font-brand text-[17px] font-semibold tracking-[-0.03em] text-mist">Pali<span className="text-aqua">sec</span></span>
        </Link>
        <span className="font-utility text-[12.5px] text-muted">Holder mandate · public record</span>
      </header>
      <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "../brand-mark";

export const PRODUCT_LINKS = [
  { href: "/accounts", label: "Accounts", text: "A Safe smart account the agent can't empty alone." },
  { href: "/limits", label: "Limits", text: "Spend and loss limits counted in dollars, on everything that leaves." },
  { href: "/mandates", label: "Mandates", text: "Holders vote an agent's limits. Palisec enforces them." },
  { href: "/agent", label: "Palisec Agent", text: "An assistant that drafts changes; a member confirms each one." },
  { href: "/architecture", label: "Architecture", text: "Every check, in the order it runs." },
  { href: "/security", label: "Security", text: "How keys, decisions and failures are handled." },
  { href: "/pricing", label: "Pricing", text: "Free to start. Pay per decision." },
];

export const NAV_LINKS = [
  { href: "/standard", label: "Standard" },
  { href: "/proof", label: "Proof" },
  { href: "/ecosystem", label: "Ecosystem" },
  { href: "/token", label: "Token" },
  { href: "/developers", label: "Developers" },
  { href: "/docs", label: "Docs" },
];

/** Opens the command menu; it listens for this event. */
export function openSearch() {
  window.dispatchEvent(new CustomEvent("palisec:search"));
}

function isActive(path: string, href: string) {
  return path === href || path.startsWith(`${href}/`);
}

export function SiteNav() {
  const path = usePathname() ?? "/";
  const [product, setProduct] = useState(false);
  const [mobile, setMobile] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const productBtn = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const productActive = PRODUCT_LINKS.some((l) => isActive(path, l.href));

  const close = useCallback((focusBack = false) => {
    setProduct(false);
    if (focusBack) productBtn.current?.focus();
  }, []);

  // Close both menus when the page changes (adjusting state during render, not in an effect).
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setProduct(false);
    setMobile(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (product) close(true);
        setMobile(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [product, close]);

  useEffect(() => {
    if (product) panelRef.current?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  }, [product]);

  useEffect(() => {
    document.documentElement.style.overflow = mobile ? "hidden" : "";
    return () => { document.documentElement.style.overflow = ""; };
  }, [mobile]);

  const hoverAt = useRef(0);
  const hoverOpen = () => {
    window.clearTimeout(closeTimer.current);
    if (!product) hoverAt.current = Date.now();
    setProduct(true);
  };

  useEffect(() => {
    if (!product) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !productBtn.current?.contains(t)) setProduct(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [product]);
  const hoverClose = () => {
    closeTimer.current = window.setTimeout(() => setProduct(false), 160);
  };

  return (
    <>
      <div aria-hidden className="nav-fade" data-intro-nav />
      <header className="fixed inset-x-0 top-0 z-50 h-[84px]" data-intro-nav>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-[4px] focus:bg-aqua focus:px-3 focus:py-1 focus:text-abyss">
          Skip to content
        </a>
        <Link href="/" aria-label="Palisec home" className="absolute left-[20px] top-1/2 flex -translate-y-1/2 items-center gap-3 lg:left-[72px]">
          <BrandMark size={30} />
          <span className="font-brand text-[22px] font-medium tracking-[-0.02em] text-mist">Palisec</span>
        </Link>

        <nav aria-label="Primary" className="absolute top-0 hidden h-full items-center gap-8 lg:flex" style={{ left: "calc(var(--line-x) + 80px)" }}>
          <div onMouseEnter={hoverOpen} onMouseLeave={hoverClose} className="relative flex h-full items-center">
            <button
              ref={productBtn}
              type="button"
              aria-expanded={product}
              aria-controls="product-panel"
              onClick={() => {
                // Hover may have just opened it; a click right after keeps it open instead of toggling it shut.
                const sinceHover = Date.now() - hoverAt.current;
                setProduct((v) => (v && sinceHover > 400 ? false : true));
              }}
              className={`relative py-2 font-utility text-[15.5px] font-medium transition-colors hover:text-mist ${productActive || product ? "text-mist" : "text-silver"}`}
            >
              Product
              {productActive ? <span aria-hidden className="absolute bottom-0 left-0 h-[2px] w-full bg-aqua" /> : null}
            </button>
          </div>
          {NAV_LINKS.map((l) => {
            const active = isActive(path, l.href);
            return (
              <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={`relative py-2 font-utility text-[15.5px] font-medium transition-colors hover:text-mist ${active ? "text-mist" : "text-silver"}`}>
                {l.label}
                {active ? <span aria-hidden className="absolute bottom-0 left-0 h-[2px] w-full bg-aqua" /> : null}
              </Link>
            );
          })}
        </nav>

        <div className="absolute right-[20px] top-1/2 flex -translate-y-1/2 items-center gap-5 lg:right-[72px]">
          <button type="button" onClick={openSearch} className="hidden items-center gap-2 font-utility text-[15.5px] font-medium text-silver transition-colors hover:text-mist lg:inline-flex">
            Search <kbd className="rounded-[4px] border border-line-strong px-1.5 font-mono text-[11px] text-dim">⌘K</kbd>
          </button>
          <Link href="/console" className="lbtn lbtn-primary sm hidden sm:inline-flex">
            <span className="relative">Console</span>
          </Link>
          <button type="button" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile((v) => !v)} className="lbtn lbtn-ghost sm !px-3 lg:hidden">
            <span className="sr-only">{mobile ? "Close menu" : "Open menu"}</span>
            <span aria-hidden className="relative block h-3 w-4">
              <span className={`absolute left-0 top-0 h-[1.5px] w-full rounded-full bg-current transition-transform duration-300 ${mobile ? "translate-y-[5.25px] rotate-45" : ""}`} />
              <span className={`absolute left-0 top-[5.25px] h-[1.5px] w-full rounded-full bg-current transition-opacity duration-200 ${mobile ? "opacity-0" : ""}`} />
              <span className={`absolute bottom-0 left-0 h-[1.5px] w-full rounded-full bg-current transition-transform duration-300 ${mobile ? "-translate-y-[5.25px] -rotate-45" : ""}`} />
            </span>
          </button>
        </div>
      </header>

      {product ? (
        <div
          id="product-panel"
          ref={panelRef}
          onMouseEnter={hoverOpen}
          onMouseLeave={hoverClose}
          className="fixed right-0 top-[84px] z-50 hidden max-h-[calc(100dvh-84px)] overflow-y-auto border-y border-line bg-abyss/95 backdrop-blur-md lg:block"
          style={{ left: "var(--line-x)" }}
        >
          <ul className="divide-y divide-line pl-[80px] pr-[150px]">
            {PRODUCT_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="group grid grid-cols-[220px_1fr] items-baseline gap-6 py-4 outline-none">
                  <span className="font-utility text-[16px] font-medium text-mist group-hover:text-aqua group-focus-visible:text-aqua">{l.label}</span>
                  <span className="text-[15px] text-silver">{l.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mobile ? (
        <div id="mobile-menu" className="fixed inset-0 top-[84px] z-50 overflow-y-auto bg-abyss lg:hidden">
          <nav aria-label="Mobile" className="pl-[44px] pr-5 pb-12">
            <p className="t-label pt-6 pb-3">Product</p>
            <ul className="divide-y divide-line border-y border-line">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="block py-4">
                    <span className="block font-utility text-[17px] font-medium text-mist">{l.label}</span>
                    <span className="block text-[14.5px] text-silver">{l.text}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {[...NAV_LINKS, { href: "/console", label: "Console" }].map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="block py-4 font-utility text-[17px] font-medium text-mist">{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      ) : null}
    </>
  );
}

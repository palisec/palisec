"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { openSearch } from "./site-nav";

/** "Search the docs ⌘K": opens the command menu. */
export function DocsSearchBox() {
  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex w-full items-center justify-between rounded-[0.375rem] border border-line-strong px-3 py-2.5 text-left font-utility text-[0.9062rem] text-dim transition-colors hover:border-aqua/50 hover:text-silver"
    >
      Search the docs
      <kbd className="rounded-[0.25rem] border border-line-strong px-1.5 font-mono text-[0.6875rem]">⌘K</kbd>
    </button>
  );
}

type Nav = { title: string; items: { href: string; label: string }[] }[];

export function DocsBreadcrumb({ nav }: { nav: Nav }) {
  const path = usePathname() ?? "/docs";
  const group = nav.find((g) => g.items.some((i) => i.href === path));
  const item = group?.items.find((i) => i.href === path);
  return (
    <nav aria-label="Breadcrumb" className="mb-8 font-mono text-[0.7812rem] text-dim">
      <Link href="/docs" className="hover:text-aqua">Docs</Link>
      {group ? <span> / {group.title}</span> : null}
      {item && item.href !== "/docs" ? <span className="text-silver"> / {item.label}</span> : null}
    </nav>
  );
}

const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** "On this page": the article's h2 and h3 headings, the current one in aqua as you scroll. */
export function OnThisPage() {
  const path = usePathname();
  const [heads, setHeads] = useState<{ id: string; text: string; level: number }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const root = document.querySelector("[data-docs-article]");
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLHeadingElement>("h2, h3"));
    const list = els.map((h) => {
      if (!h.id) h.id = slug(h.textContent ?? "");
      h.classList.add("scroll-mt-28");
      return { id: h.id, text: h.textContent ?? "", level: h.tagName === "H2" ? 2 : 3 };
    }).filter((h) => h.id && h.text);
    // Reading the DOM after the route renders: the list depends on the page that just mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeads(list);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setCurrent(vis[0].target.id);
      },
      { rootMargin: "-100px 0px -60% 0px" },
    );
    els.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [path]);

  if (heads.length < 2) return <div className="hidden xl:block" />;
  return (
    <nav aria-label="On this page" className="hidden xl:block xl:sticky xl:top-[6.875rem] xl:self-start">
      <p className="t-label mb-3">On this page</p>
      <ul className="text-[0.8438rem]">
        {heads.map((h) => (
          <li key={h.id} className={h.level === 3 ? "pl-3" : ""}>
            <a href={`#${h.id}`} className={`flex min-h-[24px] items-center py-1 transition-colors ${current === h.id ? "text-aqua" : "text-silver hover:text-mist"}`}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

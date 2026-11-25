"use client";

import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import index from "@/generated/search-index.json";

interface Entry { kind: "page" | "doc" | "heading" | "code" | "address"; title: string; href: string | null; parent?: string; detail?: string; address?: string }
const ENTRIES = index as Entry[];
const GROUPS: { kind: Entry["kind"]; label: string }[] = [
  { kind: "page", label: "Pages" },
  { kind: "doc", label: "Docs" },
  { kind: "heading", label: "In the docs" },
  { kind: "code", label: "Reason codes" },
  { kind: "address", label: "Addresses" },
];

/**
 * ⌘K / Ctrl+K, or "Search" in the navigation. Runs in the browser on a build-time index: no network call.
 * Enter on a page opens it; Enter on an address copies it.
 */
export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("palisec:search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("palisec:search", onOpen); };
  }, []);

  async function choose(e: Entry) {
    if (e.address) {
      try {
        await navigator.clipboard.writeText(e.address);
        setCopied(e.address);
        window.setTimeout(() => setCopied(null), 1500);
      } catch { /* clipboard refused */ }
      return;
    }
    if (e.href) {
      setOpen(false);
      router.push(e.href);
    }
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search Palisec"
      overlayClassName="fixed inset-0 z-[60] bg-[rgb(0_10_10/0.55)] backdrop-blur-[6px]"
      contentClassName="fixed left-1/2 top-[12vh] z-[61] w-[min(760px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-line-strong bg-[#012b29]"
    >
      <Command.Input placeholder="Search pages, docs, reason codes, addresses…" className="w-full border-b border-line bg-transparent px-5 py-4 font-utility text-[16px] text-mist placeholder:text-dim focus:outline-none" />
      <Command.List className="max-h-[60vh] overflow-y-auto p-2">
        <Command.Empty className="px-4 py-6 font-mono text-[13px] text-dim">Nothing found.</Command.Empty>
        {GROUPS.map((g) => (
          <Command.Group key={g.kind} heading={g.label} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-dim">
            {ENTRIES.filter((e) => e.kind === g.kind).map((e, i) => (
              <Command.Item
                key={`${g.kind}-${i}`}
                value={`${e.title} ${e.parent ?? ""} ${e.detail ?? ""} ${e.address ?? ""} ${e.href ?? ""}`}
                onSelect={() => choose(e)}
                className="flex cursor-pointer items-baseline justify-between gap-4 rounded-[6px] px-3 py-2.5 text-[15px] text-foam data-[selected=true]:bg-aqua/[0.08] data-[selected=true]:text-mist"
              >
                <span className="min-w-0 truncate">
                  {e.kind === "code" ? <span className="font-mono text-aqua">{e.title}</span> : e.title}
                  {e.detail ? <span className="ml-2 text-silver">{e.detail}</span> : null}
                  {e.parent ? <span className="ml-2 text-dim">· {e.parent}</span> : null}
                </span>
                {e.address ? (
                  <span className="shrink-0 font-mono text-[12.5px] text-dim">{copied === e.address ? "Copied" : `${e.address.slice(0, 6)}…${e.address.slice(-4)}`}</span>
                ) : null}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}

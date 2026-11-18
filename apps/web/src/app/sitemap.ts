import { readdirSync } from "node:fs";
import path from "node:path";
import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/*
 * Every public page, read from the route tree at build time, so a new page can never be left out.
 * Only app/(site) is public: the console, the API and /login live outside it and are never listed.
 * Route groups "(name)" add no path segment; dynamic "[x]" and private "_x" folders are skipped.
 */
const SITE_DIR = path.join(process.cwd(), "src", "app", "(site)");

function routes(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === "page.tsx") out.push(prefix || "/");
    if (!entry.isDirectory() || entry.name.startsWith("[") || entry.name.startsWith("_")) continue;
    const segment = entry.name.startsWith("(") ? "" : `/${entry.name}`;
    out.push(...routes(path.join(dir, entry.name), prefix + segment));
  }
  return out;
}

export default function sitemap(): MetadataRoute.Sitemap {
  return routes(SITE_DIR, "")
    .sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)))
    .map((p) => ({ url: new URL(p, SITE_URL).toString() }));
}

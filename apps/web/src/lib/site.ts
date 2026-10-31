/**
 * The canonical public origin, used for metadata, canonical links, robots, the sitemap and sign-in.
 * NEXT_PUBLIC_SITE_URL can override it; production otherwise uses the real domain, because hosting
 * secrets may not be available while static pages are built.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return process.env.NODE_ENV === "production" ? "https://palisec.tech" : "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

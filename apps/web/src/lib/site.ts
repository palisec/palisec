/**
 * The canonical public origin, used for metadata, canonical links, robots, the sitemap and sign-in.
 * NEXT_PUBLIC_SITE_URL can override it; production otherwise uses the real domain, so canonical links
 * never depend on a host setting.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return process.env.NODE_ENV === "production" ? "https://palisec.tech" : "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

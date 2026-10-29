/**
 * The canonical public origin, used for metadata, canonical links, robots and the sitemap.
 * An explicit NEXT_PUBLIC_SITE_URL wins (set it to https://palisec.tech); otherwise the host's
 * own public domain (Railway, or Vercel if deployed there), else localhost for development.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const hosted = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (hosted) return `https://${hosted}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

/**
 * The canonical public origin, used for metadata, canonical links, robots and the sitemap.
 * An explicit NEXT_PUBLIC_SITE_URL wins; otherwise Vercel's production domain (the shortest custom
 * domain once one is attached, e.g. palisec.tech, else the project's vercel.app domain).
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_URL = resolveSiteUrl();

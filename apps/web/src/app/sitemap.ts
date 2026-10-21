import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const ROUTES = [
  "/", "/product", "/architecture", "/security", "/attestation", "/status", "/pricing", "/changelog",
  "/docs", "/docs/quickstart", "/docs/policies", "/docs/errors", "/docs/account-abstraction",
  "/docs/sdk/typescript", "/docs/sdk/python",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((path) => ({ url: new URL(path, SITE_URL).toString() }));
}

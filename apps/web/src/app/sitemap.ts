import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";


const ROUTES = [
  "/", "/product", "/architecture", "/security", "/attestation", "/status", "/pricing", "/changelog",
  "/docs", "/docs/quickstart", "/docs/api", "/docs/policies", "/docs/errors", "/docs/account-abstraction",
  "/docs/sdk/typescript", "/docs/sdk/python",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((path) => ({ url: new URL(path, SITE_URL).toString() }));
}

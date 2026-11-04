import { openApiDocument } from "@/lib/api-reference";
import { SITE_URL } from "@/lib/site";

/** Static, so it is generated at build time and never touches the database. */
export function GET() {
  return Response.json(openApiDocument(SITE_URL), { headers: { "Cache-Control": "public, max-age=3600" } });
}

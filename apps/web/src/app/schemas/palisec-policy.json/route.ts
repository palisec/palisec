import schema from "@palisec/policy-schema/policy.schema.json";

/** The JSON Schema of Palisec policy documents: the schemaURI in Palisec's on-chain policy commitments. */
export function GET() {
  return Response.json(schema, { headers: { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
}

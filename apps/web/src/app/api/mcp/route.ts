import { createMcpHandler } from "@modelcontextprotocol/server";
import { requireAgent } from "@/server/access";
import { handle } from "@/server/http";
import { buildMcpServer } from "@/server/mcp";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless: one server instance per request, nothing held
 * between requests). Authenticated with an agent API key that has the `mcp` scope; each tool then
 * checks its own scope. Same rate limits as the REST API.
 */
const serve = handle(async (req) => {
  const agent = await requireAgent(req, "mcp");
  const handler = createMcpHandler(() => buildMcpServer(agent), { legacy: "stateless", responseMode: "json", maxRequestBodySize: 256 * 1024 });
  try {
    return await handler.fetch(req, { authInfo: { token: "[redacted]", clientId: agent.agentId, scopes: agent.scopes } });
  } finally {
    await handler.close();
  }
});

export const POST = serve;
export const GET = serve;
export const DELETE = serve;

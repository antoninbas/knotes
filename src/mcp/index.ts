import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

export async function startMcpServer(options?: { readOnly?: boolean }): Promise<void> {
  const server = new McpServer({
    name: "knotes",
    version: "0.1.0",
  });

  registerTools(server, { readOnly: options?.readOnly });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

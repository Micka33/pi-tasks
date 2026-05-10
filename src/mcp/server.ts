import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMcpTaskTools } from "./tools.js";

export function createPiTasksMcpServer(): McpServer {
  const server = new McpServer({
    name: "pi-tasks",
    version: "0.1.0",
  });

  registerMcpTaskTools(server);
  return server;
}

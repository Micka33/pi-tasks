import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMcpTaskTools } from "./tools.js";
export function createPiTasksMcpServer() {
    const server = new McpServer({
        name: "pi-tasks",
        version: "0.1.0",
    });
    registerMcpTaskTools(server);
    return server;
}
//# sourceMappingURL=server.js.map
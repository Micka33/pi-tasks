#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPiTasksMcpServer } from "./server.js";
async function main() {
    const server = createPiTasksMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((error) => {
    console.error("pi-tasks MCP server failed:", error);
    process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map
#!/usr/bin/env node
import("../dist/src/mcp/cli.js").catch((error) => {
  if (error && typeof error === "object" && "code" in error && error.code === "ERR_MODULE_NOT_FOUND") {
    console.error("pi-tasks MCP build not found. Run `npm install && npm run build`, then retry.");
  } else {
    console.error("Failed to start pi-tasks MCP server:", error);
  }
  process.exitCode = 1;
});

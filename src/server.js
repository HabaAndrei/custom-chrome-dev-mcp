// custom-chrome-dev-mcp — a local-only MCP server that drives Chrome through a
// companion extension. Inspired by Chrome's official browser MCP: an independent
// reimplementation of the same idea, aimed at imitating a real human at the keyboard
// (trusted CDP input, genuine focus changes, human-paced typing) rather than firing
// synthetic events. Not affiliated with or endorsed by Google.
//
// Layout:
//   config.js         every tunable in one place
//   relay/            the link to the hub process that owns the browser socket
//   tools/            one file per tool group; the whole public surface
//   capture/          the write allowlist for screenshots and recordings
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SERVER_NAME, VERSION } from "./config.js";
import { startRelay } from "./relay/hub-client.js";
import { registerAllTools } from "./tools/index.js";

/** Build the MCP server with every tool registered, without connecting it. */
export function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: VERSION });
  registerAllTools(server);
  return server;
}

/** Start the browser relay and serve MCP over stdio. Resolves when the client disconnects. */
export async function start() {
  startRelay();
  await createServer().connect(new StdioServerTransport());
}

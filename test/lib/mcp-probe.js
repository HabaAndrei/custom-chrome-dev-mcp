// Speaks real MCP to the real server, in-process.
//
// The offline lane used to be limited to grepping source files. With the SDK's
// in-memory transport we can complete an actual initialize + tools/list handshake
// against src/server.js - so the offline tests assert on the true published surface
// (names, descriptions, JSON Schemas) instead of on what the source looks like.
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createServer } from "../../src/server.js";

let cached = null;

/**
 * Connect a client to a freshly built server and list its tools.
 * Cached - the surface is static, and every offline test wants the same view of it.
 *
 * @returns {Promise<{tools: object[], byName: Map<string, object>, names: string[]}>}
 */
export async function describeToolSurface() {
  if (cached) return cached;

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: "custom-chrome-dev-mcp-tests", version: "1.0.0" }, { capabilities: {} });

  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();

  cached = {
    tools,
    byName: new Map(tools.map((t) => [t.name, t])),
    names: tools.map((t) => t.name).sort(),
  };
  return cached;
}

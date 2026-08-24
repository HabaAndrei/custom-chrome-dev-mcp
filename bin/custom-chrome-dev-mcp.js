#!/usr/bin/env node
// Executable entry point. Register this file with your MCP client:
//   claude mcp add -s user custom-chrome-dev-mcp -- node /ABSOLUTE/PATH/bin/custom-chrome-dev-mcp.js
import { start } from "../src/server.js";

await start();

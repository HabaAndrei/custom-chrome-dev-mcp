// Single source of truth for every knob the server and hub share.
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_NAME = "custom-chrome-dev-mcp";
export const VERSION = "0.4.0";

/** WebSocket port the hub owns and both the server and the extension dial. */
export const WS_PORT = Number(process.env.CUSTOM_CHROME_DEV_MCP_WS_PORT) || 9876;

/**
 * Shared secret for the local WebSocket. Must stay identical to AUTH_TOKEN in
 * extension/src/config.js — the hub rejects any peer that presents another value.
 */
export const AUTH_TOKEN = "bmcp-7f3a9c2e5d14";

/** The hub process, spawned detached by the first session that needs it. */
export const HUB_PATH = path.join(SRC_DIR, "hub.js");
export const HUB_LOG = path.join(os.tmpdir(), `${SERVER_NAME}-hub.log`);

/**
 * The one directory captures may be written to (screenshots, recordings). Every
 * caller-supplied path is confined to it — see src/capture/capture-path.js.
 * Defaults to Downloads so captures are easy to find.
 */
export const CAPTURE_DIR = process.env.CUSTOM_CHROME_DEV_MCP_CAPTURE_DIR
  ? path.resolve(process.env.CUSTOM_CHROME_DEV_MCP_CAPTURE_DIR)
  : path.join(os.homedir(), "Downloads");

/** How long a tool call may wait for the extension before giving up. */
export const CALL_TIMEOUT_MS = 20000;

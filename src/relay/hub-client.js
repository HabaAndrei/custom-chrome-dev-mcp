// Client side of the session <-> hub link.
//
// The server does NOT own the WebSocket. Only one process can hold port 9876, but
// several Claude sessions may want the same browser at once — so the socket lives in
// a separate long-lived hub process (src/hub.js). Every session connects to it as a
// client (role:"mcp"), the extension connects as role:"extension", and the hub
// multiplexes between them. The first session to start spawns the hub detached so it
// outlives that session; later sessions just find it already listening.
import fs from "node:fs";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { AUTH_TOKEN, CALL_TIMEOUT_MS, HUB_LOG, HUB_PATH, SERVER_NAME, WS_PORT } from "../config.js";

const RECONNECT_DELAY_MS = 1200;

let socket = null;
let nextId = 1;
const pending = new Map();

const isLive = (ws) => ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN);

/**
 * Start the hub detached so it survives this session exiting. Safe to call at any
 * time: a hub that finds the port taken self-exits on EADDRINUSE.
 */
function spawnHub() {
  try {
    const log = fs.openSync(HUB_LOG, "a");
    spawn(process.execPath, [HUB_PATH], { detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
    fs.closeSync(log);
  } catch (err) {
    console.error(`[${SERVER_NAME}] failed to spawn hub:`, err.message);
  }
}

function connect() {
  if (isLive(socket)) return;

  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}`);
  socket = ws;

  ws.on("open", () => ws.send(JSON.stringify({ type: "auth", token: AUTH_TOKEN, role: "mcp" })));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || msg.type === "pong") return;

    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    msg.error ? waiter.reject(new Error(msg.error)) : waiter.resolve(msg.result);
  });

  ws.on("close", () => {
    if (socket === ws) socket = null;
    spawnHub();                              // the hub may have died — restart it (no-op if up)
    setTimeout(connect, RECONNECT_DELAY_MS); // then retry
  });

  ws.on("error", () => {}); // always followed by "close", which handles recovery
}

/** Bring the relay up. Called once at startup. */
export function startRelay() {
  spawnHub();
  connect();
}

/**
 * Send one tool invocation to the extension and await its result.
 *
 * @param {string} tool tool name the extension's handler table knows
 * @param {object} args validated arguments
 * @returns {Promise<any>} whatever the extension handler returned
 */
export function call(tool, args, timeoutMs = CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return reject(new Error(
        "browser relay not connected yet (hub starting — retry shortly; make sure Chrome + the extension are running)",
      ));
    }

    const id = nextId++;
    pending.set(id, { resolve, reject });

    try {
      socket.send(JSON.stringify({ id, tool, args }));
    } catch (err) {
      pending.delete(id);
      return reject(err);
    }

    setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`timeout: ${tool} did not answer within ${timeoutMs}ms`));
    }, timeoutMs);
  });
}

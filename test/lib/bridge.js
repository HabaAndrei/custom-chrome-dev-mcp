// Stands in for src/hub.js during a browser run.
//
// The suite drives the extension over the SAME wire protocol the real hub uses, so a
// passing run exercises the actual message contract — not a mock of it. It also records
// every tool name it sends, which is how the runner proves coverage.
import { WebSocketServer } from "ws";

export const BRIDGE_PORT = 9876;
const DEFAULT_TIMEOUT = 25000;

/**
 * Bind the bridge port and wait for the extension to connect.
 *
 * @param {{port?: number, timeout?: number, onWaiting?: (url: string) => void}} opts
 * @returns {Promise<{build: string, call: Function, invoked: Set<string>, close: Function}>}
 */
export function connectExtension({ port = BRIDGE_PORT, timeout = 240000, onWaiting } = {}) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    const pending = new Map();
    const invoked = new Set();
    let socket = null;
    let nextId = 1;

    const giveUp = setTimeout(() => {
      wss.close();
      reject(new Error(
        `no extension connected within ${Math.round(timeout / 1000)}s — open chrome://extensions and click reload ↻ on Custom-chrome-dev-mcp`,
      ));
    }, timeout);

    wss.on("error", (err) => {
      clearTimeout(giveUp);
      reject(err.code === "EADDRINUSE"
        ? new Error(
            `port ${port} is taken. Killing the hub is NOT enough on its own: a connected MCP ` +
            `client (Claude Code) respawns it every ~1.2s, so it wins the port straight back. ` +
            `Close the MCP client first — or disable the custom-chrome-dev-mcp server for the ` +
            `run — then:  pkill -f src/hub.js && npm run test:browser`,
          )
        : err);
    });

    wss.on("listening", () => onWaiting?.(`ws://127.0.0.1:${port}`));

    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        // First frame from the extension is its auth handshake.
        if (!socket) {
          if (msg?.type !== "auth") return;
          socket = ws;
          clearTimeout(giveUp);
          resolve({ build: msg.build, call, invoked, close });
          return;
        }

        if (msg?.type === "pong" || msg?.id == null) return;
        const waiter = pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        msg.error ? waiter.reject(new Error(msg.error)) : waiter.resolve(msg.result);
      });

      ws.on("close", () => { if (socket === ws) socket = null; });
    });

    /** Send one tool call to the extension, exactly as the hub would. */
    function call(tool, args = {}, timeoutMs = DEFAULT_TIMEOUT) {
      invoked.add(tool);
      return new Promise((res, rej) => {
        if (!socket || socket.readyState !== 1) return rej(new Error("extension disconnected mid-run"));
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, tool, args }));
        setTimeout(() => {
          if (!pending.delete(id)) return;
          rej(new Error(`timeout: ${tool} did not answer within ${timeoutMs}ms`));
        }, timeoutMs);
      });
    }

    function close() {
      clearTimeout(giveUp);
      for (const [, waiter] of pending) waiter.reject(new Error("bridge closed"));
      pending.clear();
      return new Promise((done) => wss.close(done));
    }
  });
}

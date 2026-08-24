// The socket to the hub, and the trick that keeps it alive.
//
// An MV3 service worker is torn down after ~30s idle, which silently drops this
// WebSocket and makes every MCP tool fail with "extension not connected" until
// something wakes the worker back up. Sending or receiving on the socket resets that
// idle timer (Chrome 116+), so a sub-30s heartbeat keeps BOTH the worker and the
// connection alive for as long as the MCP server is running. The alarm is a cold-start
// backstop that revives the worker after a hard termination.
import { AUTH_TOKEN, BUILD, HEARTBEAT_MS, RECONNECT_MS, WS_URL } from "./config.js";

let socket = null;
let heartbeat = null;

/**
 * Open (and keep open) the hub connection.
 * @param {(tool: string, args: object) => Promise<any>} dispatch handler router
 */
export function startConnection(dispatch) {
  const connect = () => {
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) return;

    const ws = new WebSocket(WS_URL);
    socket = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token: AUTH_TOKEN, role: "extension", build: BUILD }));
      console.log("[custom-chrome-dev-mcp] connected + authenticated to", WS_URL);
      startHeartbeat();
    };

    ws.onclose = () => { socket = null; setTimeout(connect, RECONNECT_MS); };
    ws.onerror = (e) => { e.preventDefault?.(); };

    ws.onmessage = async (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || msg.id == null) return; // pong / heartbeat frames carry no id

      try {
        ws.send(JSON.stringify({ id: msg.id, result: await dispatch(msg.tool, msg.args || {}) }));
      } catch (err) {
        ws.send(JSON.stringify({ id: msg.id, error: String(err?.message || err) }));
      }
    };
  };

  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
      if (socket && socket.readyState === 1) {
        try { socket.send(JSON.stringify({ type: "ping" })); } catch {}
      } else {
        connect();
      }
    }, HEARTBEAT_MS);
  };

  connect();
  startHeartbeat();
  chrome.runtime.onStartup.addListener(connect);
  chrome.runtime.onInstalled.addListener(connect);
  // Chrome clamps alarm periods to a 30s minimum; this revives a hard-killed worker.
  chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(() => connect());
}

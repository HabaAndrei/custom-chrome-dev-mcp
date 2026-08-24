#!/usr/bin/env node
// custom-chrome-dev-mcp hub - a small, long-lived relay so MULTIPLE Claude Code sessions can
// all drive the single browser extension AT THE SAME TIME.
//
//   [Claude session 1] relay/hub-client ─┐
//   [Claude session 2] relay/hub-client ─┼─(ws, role:"mcp") → [hub :9876] ← (ws, role:"extension") ─ [Chrome extension]
//   [Claude session N] relay/hub-client ─┘
//
// Only one process can own port 9876, so the socket lives HERE instead of inside any
// one session. The hub keeps the single extension socket plus a set of mcp-client
// sockets, and multiplexes: each {id,tool,args} from a client is re-tagged with a
// hub-global id, forwarded to the extension, and the reply is routed back to the
// originating client under its ORIGINAL id (ids can collide across clients, so the hub
// owns the id space on the wire to the extension). Spawned detached by whichever
// session starts first, so it outlives any single Claude session.
import { WebSocketServer } from "ws";
import { AUTH_TOKEN, WS_PORT } from "./config.js";

let extSock = null;            // the browser extension
const mcpClients = new Set();  // one per Claude session's server.js
const route = new Map();       // hubId -> { client, origId, ts }
let nextHubId = 1;

const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
wss.on("listening", () => console.error(`[hub] listening on 127.0.0.1:${WS_PORT}`));
wss.on("error", (err) => {
  if (err.code === "EADDRINUSE") process.exit(0); // another hub already owns it - defer to it
  console.error("[hub] server error:", err.message);
  process.exit(1);
});

wss.on("connection", (ws) => {
  let role = null;
  const authTimer = setTimeout(() => { if (!role) ws.close(); }, 3000);

  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (!role) { // handshake: classify this socket as the extension or an mcp client
      if (!msg || msg.type !== "auth" || msg.token !== AUTH_TOKEN) { ws.close(); return; }
      role = msg.role === "mcp" ? "mcp" : "extension";
      clearTimeout(authTimer);
      if (role === "extension") { extSock = ws; console.error("[hub] extension connected"); }
      else { mcpClients.add(ws); console.error(`[hub] mcp client connected (${mcpClients.size} active)`); }
      return;
    }

    if (msg.type === "ping") { try { ws.send(JSON.stringify({ type: "pong" })); } catch {} return; }

    if (role === "extension") {
      // A tool result coming back - route to the client that asked, restoring its id.
      const r = route.get(msg.id);
      if (!r) return;
      route.delete(msg.id);
      if (r.client.readyState === 1)
        try { r.client.send(JSON.stringify({ id: r.origId, result: msg.result, error: msg.error })); } catch {}
      return;
    }

    // role === "mcp": a command headed for the extension.
    if (msg.id == null || !msg.tool) return;
    if (!extSock || extSock.readyState !== 1) {
      try { ws.send(JSON.stringify({ id: msg.id, error: "extension not connected (open Chrome, load/reload the extension)" })); } catch {}
      return;
    }
    const hubId = nextHubId++;
    route.set(hubId, { client: ws, origId: msg.id, ts: Date.now() });
    try { extSock.send(JSON.stringify({ id: hubId, tool: msg.tool, args: msg.args })); }
    catch { route.delete(hubId); try { ws.send(JSON.stringify({ id: msg.id, error: "failed to reach extension" })); } catch {} }
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    if (ws === extSock) { extSock = null; console.error("[hub] extension disconnected"); }
    if (mcpClients.delete(ws)) {
      for (const [hubId, r] of route) if (r.client === ws) route.delete(hubId);
      console.error(`[hub] mcp client disconnected (${mcpClients.size} active)`);
    }
  });
  ws.on("error", () => {});
});

// Drop orphaned routes (extension never replied) so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [hubId, r] of route) if (now - r.ts > 60000) route.delete(hubId);
}, 30000).unref();

// Debugger attach/detach lifecycle and the raw CDP command channel.
//
// Attaching is what puts the yellow "being debugged" banner on a tab, so it happens
// lazily - only when a tool actually needs trusted input, evaluation, or capture.
import { runWalker } from "../walker-bridge.js";
import { toTarget, forgetIfPinned } from "../tabs.js";
import { clearBuffers } from "./buffers.js";

const attached = new Set();

/**
 * Where the virtual cursor currently sits, per tab. A real pointer has a position
 * between actions; without remembering it, every move would start from nowhere and
 * arrive as a single teleport.
 */
const pointerAt = new Map();

export const getPointer = (tabId) => pointerAt.get(tabId) || null;
export const setPointer = (tabId, point) => pointerAt.set(tabId, point);

export const isAttached = (tabId) => attached.has(tabId);

/** Send one CDP command to a tab. */
export const cdp = (tabId, method, params = {}) => chrome.debugger.sendCommand({ tabId }, method, params);

/** Attach the debugger if it isn't already, enabling the observability domains. */
export async function ensureAttached(tabId) {
  if (attached.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attached.add(tabId);
  // Best-effort: getConsole/listNetworkRequests need these, but a failure here
  // shouldn't block the tool that triggered the attach.
  for (const domain of ["Log.enable", "Runtime.enable", "Network.enable"]) {
    try { await cdp(tabId, domain, {}); } catch {}
  }
}

/** Detach the debugger from a tab, clearing its banner. */
export async function detachFrom(tabId) {
  if (!attached.has(tabId)) return false;
  await chrome.debugger.detach({ tabId });
  attached.delete(tabId);
  return true;
}

/** Forget all per-tab state (debugger gone, or the tab closed). */
function forgetTab(tabId) {
  attached.delete(tabId);
  pointerAt.delete(tabId);
  clearBuffers(tabId);
}

/** Resolve a tool's target to CSS-pixel coordinates: explicit x/y, else element centre. */
export async function centerOf(tabId, args) {
  if (args && args.x != null && args.y != null) return { x: args.x, y: args.y };
  const rect = await runWalker(tabId, "rect", { target: toTarget(args) });
  return { x: rect.x, y: rect.y };
}

/** Wire tab/debugger teardown to state cleanup. Called once at startup. */
export function installSessionListeners() {
  chrome.debugger.onDetach.addListener((src) => { if (src.tabId != null) forgetTab(src.tabId); });
  chrome.tabs.onRemoved.addListener((tabId) => { forgetTab(tabId); forgetIfPinned(tabId); });
}

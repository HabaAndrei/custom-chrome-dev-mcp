// Bridge to walker.js, the script injected into the page's ISOLATED world.
//
// The walker owns everything that must run inside the document: element resolution,
// the ref map, and the synthetic DOM operations. This module is the only thing that
// knows how to reach it.
import { WALKER_FILE } from "./config.js";
import { resolveTab } from "./tabs.js";

/**
 * Inject the walker (idempotent) and run one operation in it.
 *
 * @param {number} tabId
 * @param {string} op walker op name
 * @param {object} args op arguments
 * @param {number} [frameId] target a specific frame - this is what lets tools reach
 *   into cross-origin iframes the top document cannot script.
 */
export async function runWalker(tabId, op, args, frameId) {
  const target = frameId != null ? { tabId, frameIds: [frameId] } : { tabId };

  await chrome.scripting.executeScript({ target, files: [WALKER_FILE] });
  const [res] = await chrome.scripting.executeScript({
    target,
    func: (o, a) => window.__bmcp.run(o, a),
    args: [op, args],
  });

  const result = res?.result;
  // The walker returns errors as data so they survive the executeScript boundary.
  if (result && typeof result === "object" && result.__error) throw new Error(result.__error);
  return result;
}

/** Resolve the tab from tool args, then run a walker op against it. */
export async function domOp(op, args, toolArgs = {}) {
  const tab = await resolveTab(toolArgs);
  return runWalker(tab.id, op, args, toolArgs.frameId);
}

// Which tab an incoming tool call actually acts on, and whether it is allowed to.
import { BANLIST } from "./config.js";

/** Throw if the URL is on the banlist. */
export function banCheck(url) {
  if (BANLIST.some((re) => re.test(url))) throw new Error("URL is banlisted: " + url);
}

// A pinned tab makes every subsequent tool target that tab regardless of OS focus, so
// a background tab stealing "active" status can't hijack (or misdirect) an action.
let pinnedTabId = null;

export const getPinnedTabId = () => pinnedTabId;
export const pinTab = (tabId) => { pinnedTabId = tabId; return pinnedTabId; };
export const unpinTab = () => { const was = pinnedTabId; pinnedTabId = null; return was; };
/** Drop the pin if it points at this tab (called when a tab closes). */
export const forgetIfPinned = (tabId) => { if (pinnedTabId === tabId) pinnedTabId = null; };

/**
 * Resolve the tab a tool should act on.
 * Precedence: explicit args.tabId > pinned tab > the OS-active tab.
 *
 * @param {object} args tool arguments (tabId, expectUrl)
 * @param {{requireScriptable?: boolean}} opts requireScriptable rejects chrome:// and
 *   banlisted pages — set false for tools that only read tab metadata or capture pixels.
 */
export async function resolveTab(args = {}, { requireScriptable = true } = {}) {
  const wantId = args && args.tabId != null ? args.tabId : pinnedTabId;
  let tab = null;

  if (wantId != null) {
    tab = await chrome.tabs.get(wantId).catch(() => null);
    if (!tab) {
      forgetIfPinned(wantId);
      throw new Error("tab not found: " + wantId + " (closed? pass a valid tabId or call unpinTab)");
    }
  } else {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) throw new Error("no active tab");
  }

  // Optional guard: refuse rather than act on the wrong page.
  if (args && args.expectUrl && (!tab.url || !tab.url.includes(args.expectUrl))) {
    throw new Error(
      `refusing to act: tab ${tab.id} url ${JSON.stringify(tab.url || "")} does not contain expectUrl ${JSON.stringify(args.expectUrl)}`,
    );
  }

  if (requireScriptable) {
    if (!tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://"))
      throw new Error("Cannot access internal URL: " + tab.url);
    banCheck(tab.url);
  }

  return tab;
}

/** Normalise the three ways a caller may address an element into the walker's shape. */
export function toTarget(args) {
  if (args.ref) return { ref: args.ref };
  if (args.selector) return { selector: args.selector };
  if (args.name) return args.name;
  return undefined;
}

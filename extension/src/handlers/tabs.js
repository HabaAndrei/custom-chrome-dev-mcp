// Mirrors src/tools/tabs.js on the server.
import { domOp } from "../walker-bridge.js";
import { getPinnedTabId, pinTab, resolveTab, unpinTab, forgetIfPinned } from "../tabs.js";

const META = { requireScriptable: false };

const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

export const tabHandlers = {
  async listTabs() {
    const tabs = await chrome.tabs.query({});
    const pinned = getPinnedTabId();
    return tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active, windowId: t.windowId, pinned: t.id === pinned }));
  },

  async activateTab({ tabId }) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { active: tabId };
  },

  async closeTab({ tabId }) {
    forgetIfPinned(tabId);
    await chrome.tabs.remove(tabId);
    return { closed: tabId };
  },

  // Pin the working tab so later tools ignore OS focus (survives a background tab
  // stealing "active"). Defaults to the current active tab when no id is given.
  async useTab(a = {}) {
    const tab = await resolveTab(a, META);
    return { pinned: pinTab(tab.id), url: tab.url, title: tab.title };
  },

  async unpinTab() {
    return { unpinned: unpinTab() };
  },

  // List every frame (incl. cross-origin) with its frameId + url, so a caller can pass
  // frameId to any tool to interact inside it. Falls back to a DOM scan.
  async listFrames(a = {}) {
    const tab = await resolveTab(a, META);
    try {
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return {
        count: frames.length,
        frames: frames.map((f) => ({ frameId: f.frameId, parentFrameId: f.parentFrameId, url: f.url, origin: originOf(f.url) })),
      };
    } catch {
      return domOp("listFramesDom", {}, a);
    }
  },
};

// Mirrors src/tools/navigation.js on the server.
import { banCheck, resolveTab } from "../tabs.js";
import { runWalker } from "../walker-bridge.js";

const META = { requireScriptable: false }; // these only read/steer tab metadata

/** Poll the tab until its url differs from `before`, or give up. */
async function urlMoved(tabId, before, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.url && tab.url !== before) return tab.url;
    await new Promise((r) => setTimeout(r, 80));
  }
  return null;
}

/**
 * Walk the tab's session history by `delta` (-1 back, +1 forward).
 *
 * chrome.tabs.goBack/goForward are the obvious API, but goBack has been observed to
 * refuse with "Cannot find a next page in history." on tabs that demonstrably DO have
 * a back entry - the same tab's own history.back() moves it without complaint. Trusting
 * the tabs API alone therefore made `back` fail on ordinary two-page histories.
 *
 * So: try the tabs API, and when it refuses, drive the renderer's history directly and
 * confirm the url actually moved before reporting success - otherwise a genuinely empty
 * history would look like a silent no-op instead of an error.
 */
async function walkHistory(tab, delta) {
  const before = tab.url;
  try {
    if (delta < 0) await chrome.tabs.goBack(tab.id);
    else await chrome.tabs.goForward(tab.id);
    return { ok: true, tabId: tab.id, via: "tabs" };
  } catch {
    // The tabs API declined; fall through and ask the page itself.
  }

  try {
    await runWalker(tab.id, "historyGo", { delta });
  } catch (err) {
    throw new Error(`cannot go ${delta < 0 ? "back" : "forward"}: ${err.message}`);
  }

  const url = await urlMoved(tab.id, before);
  if (!url) throw new Error(`cannot go ${delta < 0 ? "back" : "forward"}: no such entry in history`);
  return { ok: true, tabId: tab.id, url, via: "history" };
}

export const navigationHandlers = {
  async navigate(a) {
    banCheck(a.url);
    const tab = await resolveTab(a, META);
    await chrome.tabs.update(tab.id, { url: a.url });
    return { navigated: a.url, tabId: tab.id };
  },

  async newtab({ url }) {
    banCheck(url);
    const tab = await chrome.tabs.create({ url, active: true });
    return { created: tab.id, url };
  },

  async back(a) {
    return walkHistory(await resolveTab(a, META), -1);
  },

  async forward(a) {
    return walkHistory(await resolveTab(a, META), 1);
  },

  async reload(a = {}) {
    const tab = await resolveTab(a, META);
    await chrome.tabs.reload(tab.id, { bypassCache: !!a.hard });
    return { ok: true, tabId: tab.id };
  },

  async getUrl(a) {
    const tab = await resolveTab(a, META);
    return { url: tab.url, tabId: tab.id };
  },

  async getTitle(a) {
    const tab = await resolveTab(a, META);
    return { title: tab.title, tabId: tab.id };
  },

  async waitForLoad(a = {}) {
    const timeout = a.timeout ?? 15000;
    const tab = await resolveTab(a, META);
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeout) {
      const t = await chrome.tabs.get(tab.id);
      if (t.status === "complete") return { loaded: true, waitedMs: Date.now() - startedAt, url: t.url };
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("timeout waiting for load");
  },
};

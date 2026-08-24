// Mirrors src/tools/navigation.js on the server.
import { banCheck, resolveTab } from "../tabs.js";

const META = { requireScriptable: false }; // these only read/steer tab metadata

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
    const tab = await resolveTab(a, META);
    await chrome.tabs.goBack(tab.id);
    return { ok: true, tabId: tab.id };
  },

  async forward(a) {
    const tab = await resolveTab(a, META);
    await chrome.tabs.goForward(tab.id);
    return { ok: true, tabId: tab.id };
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

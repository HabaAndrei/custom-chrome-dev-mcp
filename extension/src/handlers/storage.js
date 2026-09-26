// Mirrors src/tools/storage.js on the server.
//
// Cookies go through the CDP Network domain, which sees httpOnly cookies a content
// script never could. localStorage/sessionStorage go through Runtime.evaluate in the
// page's real JS context - the same execution path evaluate() uses - so every storage
// op is consistent with one model instead of two (CDP for one area, content-script
// access for the other). resolveTab() keeps its default requireScriptable:true here,
// so the ban list still protects cookies/storage on sensitive domains.
import { resolveTab } from "../tabs.js";
import { cdp, ensureAttached } from "../cdp/session.js";

async function runJS(tabId, expression) {
  const r = await cdp(tabId, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval error");
  return r.result?.value;
}

const STORAGE_OBJ = { local: "localStorage", session: "sessionStorage" };

function storageObj(area) {
  const obj = STORAGE_OBJ[area];
  if (!obj) throw new Error(`area must be "local" or "session", got: ${JSON.stringify(area)}`);
  return obj;
}

export const storageHandlers = {
  async getCookies(a = {}) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const { cookies } = await cdp(tab.id, "Network.getCookies", { urls: [tab.url] });
    return { count: cookies.length, cookies };
  },

  async setCookie(a) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const { success } = await cdp(tab.id, "Network.setCookie", {
      name: a.name,
      value: a.value,
      url: a.url || tab.url,
      domain: a.domain,
      path: a.path,
      secure: a.secure,
      httpOnly: a.httpOnly,
      sameSite: a.sameSite,
      expires: a.expires,
    });
    if (!success) throw new Error("setCookie rejected by the browser (check domain/url/secure combination)");
    return { ok: true };
  },

  async deleteCookie(a) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    await cdp(tab.id, "Network.deleteCookies", { name: a.name, url: a.url || tab.url, domain: a.domain, path: a.path });
    return { ok: true };
  },

  async clearCookies(a = {}) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const { cookies } = await cdp(tab.id, "Network.getCookies", { urls: [tab.url] });
    for (const c of cookies) await cdp(tab.id, "Network.deleteCookies", { name: c.name, domain: c.domain, path: c.path });
    return { cleared: cookies.length };
  },

  async getStorage(a) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const obj = storageObj(a.area);
    if (a.key != null) {
      const value = await runJS(tab.id, `${obj}.getItem(${JSON.stringify(a.key)})`);
      return { key: a.key, value: value ?? null };
    }
    const entries = await runJS(tab.id, `Object.assign({}, ${obj})`);
    return { area: a.area, entries: entries || {} };
  },

  async setStorageItem(a) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const obj = storageObj(a.area);
    await runJS(tab.id, `${obj}.setItem(${JSON.stringify(a.key)}, ${JSON.stringify(a.value)})`);
    return { ok: true };
  },

  async removeStorageItem(a) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const obj = storageObj(a.area);
    await runJS(tab.id, `${obj}.removeItem(${JSON.stringify(a.key)})`);
    return { ok: true };
  },

  async clearStorage(a) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);
    const obj = storageObj(a.area);
    await runJS(tab.id, `${obj}.clear()`);
    return { ok: true };
  },
};

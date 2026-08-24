// Mirrors src/tools/observability.js on the server.
//
// The buffers only fill while the debugger is attached, so every handler attaches
// first - that also means a page loaded before the first attach has no history here.
import { resolveTab } from "../tabs.js";
import { cdp, ensureAttached } from "../cdp/session.js";
import { getConsoleEntries, getNetworkRecords, resetConsole } from "../cdp/buffers.js";

const META = { requireScriptable: false };
const DEFAULT_LIMIT = 100;
const BODY_LIMIT = 5000;
const BASE64_BODY_LIMIT = 2000;

const EMPTY_NOTE = "empty - capture starts when the debugger attaches; reload the page after attaching to capture load-time logs";

export const observabilityHandlers = {
  async getConsole(a = {}) {
    const tab = await resolveTab(a, META);
    await ensureAttached(tab.id); // ensures Log/Runtime are enabled going forward

    const all = getConsoleEntries(tab.id);
    const filtered = a.level ? all.filter((e) => e.level === a.level) : all;
    const out = filtered.slice(-(a.limit || DEFAULT_LIMIT));
    if (a.clear) resetConsole(tab.id);

    return { count: out.length, entries: out, note: filtered.length ? undefined : EMPTY_NOTE };
  },

  async listNetworkRequests(a = {}) {
    const tab = await resolveTab(a, META);
    await ensureAttached(tab.id);

    let list = [...getNetworkRecords(tab.id).values()];
    if (a.urlContains) list = list.filter((r) => (r.url || "").includes(a.urlContains));
    if (a.status != null) list = list.filter((r) => r.status === a.status);
    if (a.failedOnly) list = list.filter((r) => r.failed);

    return { count: list.length, requests: list.slice(-(a.limit || DEFAULT_LIMIT)) };
  },

  async getNetworkRequest(a) {
    const tab = await resolveTab(a, META);
    const record = getNetworkRecords(tab.id).get(a.requestId);
    if (!record) throw new Error("no such requestId in buffer: " + a.requestId);

    let body = null;
    if (a.includeBody) {
      try {
        await ensureAttached(tab.id);
        const r = await cdp(tab.id, "Network.getResponseBody", { requestId: a.requestId });
        body = r.base64Encoded
          ? "(base64) " + (r.body || "").slice(0, BASE64_BODY_LIMIT)
          : (r.body || "").slice(0, BODY_LIMIT);
      } catch (e) {
        body = "(unavailable: " + (e.message || e) + ")";
      }
    }
    return { ...record, body };
  },

  async evaluate(a) {
    // Runs in the page's REAL JS context via CDP, which bypasses the content-script
    // CSP that blocks eval() in the ISOLATED world.
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);

    const r = await cdp(tab.id, "Runtime.evaluate", { expression: a.expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval error");

    const value = r.result?.value;
    if (value === undefined) {
      if (r.result?.type === "undefined") return "undefined";
      return r.result?.type === "object" ? "null" : "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  },
};

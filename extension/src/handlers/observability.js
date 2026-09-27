// Mirrors src/tools/observability.js on the server.
//
// The buffers only fill while the debugger is attached, so every handler attaches
// first - that also means a page loaded before the first attach has no history here.
import { resolveTab } from "../tabs.js";
import { cdp, ensureAttached } from "../cdp/session.js";
import { getConsoleEntries, getNetworkRecords, resetConsole } from "../cdp/buffers.js";
import { BUILD } from "../config.js";

const META = { requireScriptable: false };
const DEFAULT_LIMIT = 100;
const BODY_LIMIT = 5000;
const BASE64_BODY_LIMIT = 2000;

const EMPTY_NOTE = "empty - capture starts when the debugger attaches; reload the page after attaching to capture load-time logs";

// Same throughput/latency values Chrome DevTools' Network panel presets use.
// Throughput is bytes/sec; -1 means "don't override" (Network.emulateNetworkConditions).
const NETWORK_PRESETS = {
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
  slow3g: { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 },
  fast3g: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
};

/** Best-effort HAR 1.2 entry - headers and exact byte sizes aren't buffered, so those
 * fields are approximated (-1, the HAR spec's "unknown" sentinel) rather than invented. */
function toHarEntry(rec) {
  const startedDateTime = rec.wallTime != null ? new Date(rec.wallTime * 1000).toISOString() : new Date(0).toISOString();
  const endTs = rec.finishedTs ?? rec.respTs;
  const time = endTs != null && rec.ts != null ? Math.max(0, Math.round((endTs - rec.ts) * 1000)) : 0;
  return {
    startedDateTime,
    time,
    request: { method: rec.method || "GET", url: rec.url, httpVersion: "HTTP/1.1", headers: [], queryString: [], cookies: [], headersSize: -1, bodySize: -1 },
    response: {
      status: rec.status || 0,
      statusText: rec.failed ? rec.errorText || "failed" : "",
      httpVersion: "HTTP/1.1",
      headers: [],
      cookies: [],
      content: { size: rec.encodedDataLength || 0, mimeType: rec.mimeType || "" },
      redirectURL: "",
      headersSize: -1,
      bodySize: rec.encodedDataLength ?? -1,
    },
    cache: {},
    timings: { blocked: -1, dns: -1, connect: -1, ssl: -1, send: 0, wait: time, receive: 0 },
    _resourceType: rec.type,
    _requestId: rec.requestId,
  };
}

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

  async setNetworkConditions(a = {}) {
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);

    const base = NETWORK_PRESETS[a.preset || "none"];
    if (!base) throw new Error(`unknown preset: ${JSON.stringify(a.preset)} (offline|slow3g|fast3g|none)`);
    const conditions = {
      offline: a.offline ?? base.offline,
      latency: a.latency ?? base.latency,
      downloadThroughput: a.downloadThroughput ?? base.downloadThroughput,
      uploadThroughput: a.uploadThroughput ?? base.uploadThroughput,
    };
    await cdp(tab.id, "Network.emulateNetworkConditions", conditions);
    return { applied: conditions };
  },

  async getEventListeners(a) {
    // Command Line API functions (getEventListeners(), $, $$, ...) only get injected
    // via includeCommandLineAPI:true for the DevTools frontend's own CDP session - a
    // chrome.debugger-attached client like this extension never gets them, even with
    // that flag set (confirmed live: ReferenceError, not a permissions error). The
    // DOMDebugger domain is the real CDP-native equivalent, keyed off a remote object
    // rather than a ref, which is why this can only take a selector.
    const tab = await resolveTab(a);
    await ensureAttached(tab.id);

    const evalResult = await cdp(tab.id, "Runtime.evaluate", { expression: `document.querySelector(${JSON.stringify(a.selector)})` });
    if (evalResult.exceptionDetails)
      throw new Error(evalResult.exceptionDetails.exception?.description || evalResult.exceptionDetails.text || "eval error");
    const objectId = evalResult.result?.objectId;
    if (!objectId) throw new Error("selector not found: " + a.selector);

    try {
      const { listeners } = await cdp(tab.id, "DOMDebugger.getEventListeners", { objectId });
      const out = {};
      for (const l of listeners) (out[l.type] ||= []).push({ useCapture: !!l.useCapture, passive: !!l.passive, once: !!l.once });
      return { selector: a.selector, listeners: out };
    } finally {
      await cdp(tab.id, "Runtime.releaseObject", { objectId }).catch(() => {});
    }
  },

  async getHar(a = {}) {
    const tab = await resolveTab(a, META);
    await ensureAttached(tab.id);

    let records = [...getNetworkRecords(tab.id).values()];
    if (a.urlContains) records = records.filter((r) => (r.url || "").includes(a.urlContains));
    records = records.slice(-(a.limit || DEFAULT_LIMIT));

    return {
      log: {
        version: "1.2",
        creator: { name: "custom-chrome-dev-mcp", version: BUILD },
        entries: records.map(toHarEntry),
      },
    };
  },
};

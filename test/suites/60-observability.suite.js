// Covers src/tools/observability.js - console, network, page-context evaluation.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, fail, hasKey, isAtLeast, rejects } from "../lib/assert.js";
import { eventually } from "../lib/wait.js";

/** Unique per run so a stale buffer entry can never make a test pass by accident. */
const marker = (label) => `cdm-${label}-${Math.random().toString(36).slice(2, 10)}`;

export default defineSuite({
  name: "observability",
  lane: "browser",

  tests: {
    "evaluate returns a computed value": async ({ js }) => {
      equals(await js("6 * 7"), "42", "evaluate result");
      return "42";
    },

    "evaluate awaits a promise": async ({ js }) => {
      equals(await js("Promise.resolve(1 + 1)"), "2", "awaited result");
      return "2";
    },

    "evaluate serialises objects": async ({ js }) => {
      contains(await js("({ a: 1, b: [2, 3] })"), '"a":1', "serialised object");
      return "json";
    },

    "evaluate surfaces a thrown error": async ({ call, tab }) => {
      await rejects(() => call("evaluate", { expression: "throw new Error('boom-from-page')", tabId: tab }), "boom-from-page", "evaluate");
      return "propagated";
    },

    "getConsole captures a console.log": async ({ call, tab, js }) => {
      const token = marker("console");
      await js(`console.log(${JSON.stringify(token)})`);
      const found = await eventually(async () => {
        const { entries } = await call("getConsole", { tabId: tab });
        return JSON.stringify(entries).includes(token) ? entries.length : false;
      }, { what: "the console marker to be buffered" });
      return `${found} entries`;
    },

    "getConsole filters by level": async ({ call, tab, js }) => {
      const token = marker("error");
      await js(`console.error(${JSON.stringify(token)})`);
      await eventually(async () => {
        const { entries } = await call("getConsole", { tabId: tab, level: "error" });
        return JSON.stringify(entries).includes(token);
      }, { what: "the error entry to be buffered at level=error" });
      return "level=error";
    },

    "getConsole clear empties the buffer": async ({ call, tab, js }) => {
      await js(`console.log(${JSON.stringify(marker("clear"))})`);
      await eventually(async () => (await call("getConsole", { tabId: tab })).count > 0, { what: "something to buffer" });
      await call("getConsole", { tabId: tab, clear: true });
      const after = await call("getConsole", { tabId: tab });
      equals(after.count, 0, "entries after clear");
      return "cleared";
    },

    "listNetworkRequests captures a fetch": async ({ call, tab, js }) => {
      const token = marker("net");
      await js(`fetch('/ping?tag=${token}').catch(() => {})`);
      const count = await eventually(async () => {
        const { count } = await call("listNetworkRequests", { tabId: tab, urlContains: token });
        return count || false;
      }, { what: "the fetch to appear in the network buffer" });
      isAtLeast(count, 1, "captured requests");
      return `${count} request`;
    },

    "listNetworkRequests records the response status": async ({ call, tab, js }) => {
      const token = marker("status");
      await js(`fetch('/ping?tag=${token}').catch(() => {})`);
      const record = await eventually(async () => {
        const { requests } = await call("listNetworkRequests", { tabId: tab, urlContains: token });
        return requests.find((r) => r.status) || false;
      }, { what: "a status to be recorded" });
      equals(record.status, 200, "response status");
      return "200";
    },

    "getNetworkRequest fetches one record by id": async ({ call, tab, js }) => {
      const token = marker("detail");
      await js(`fetch('/detail?tag=${token}').catch(() => {})`);
      const record = await eventually(async () => {
        const { requests } = await call("listNetworkRequests", { tabId: tab, urlContains: token });
        return requests[0] || false;
      }, { what: "the request to be buffered" });

      const detail = await call("getNetworkRequest", { requestId: record.requestId, tabId: tab });
      equals(detail.requestId, record.requestId, "requestId");
      contains(detail.url, token, "request url");
      return "matched";
    },

    "getNetworkRequest can include the response body": async ({ call, tab, js }) => {
      const token = marker("body");
      await js(`fetch('/ping?tag=${token}').catch(() => {})`);
      const record = await eventually(async () => {
        const { requests } = await call("listNetworkRequests", { tabId: tab, urlContains: token });
        return requests.find((r) => r.status) || false;
      }, { what: "the response to complete" });

      const detail = await call("getNetworkRequest", { requestId: record.requestId, includeBody: true, tabId: tab });
      if (detail.body == null) fail("includeBody returned no body at all");
      return "body present";
    },

    "getNetworkRequest rejects an unknown id": async ({ call, tab }) => {
      await rejects(() => call("getNetworkRequest", { requestId: "no-such-request-id", tabId: tab }), "no such requestId", "getNetworkRequest");
      return "rejected";
    },

    "setNetworkConditions offline blocks a fetch, none restores it": async ({ call, tab, js }) => {
      await call("setNetworkConditions", { preset: "offline", tabId: tab });
      const blocked = await js(`fetch('/ping?tag=${marker("off")}').then(() => "ok").catch(() => "blocked")`);
      equals(blocked, "blocked", "fetch while offline");

      await call("setNetworkConditions", { preset: "none", tabId: tab });
      const restored = await js(`fetch('/ping?tag=${marker("on")}').then(() => "ok").catch(() => "blocked")`);
      equals(restored, "ok", "fetch after restoring");
      return "offline then restored";
    },

    "setNetworkConditions accepts explicit latency/throughput overrides": async ({ call, tab }) => {
      const result = await call("setNetworkConditions", { latency: 123, downloadThroughput: 5000, uploadThroughput: 5000, tabId: tab });
      equals(result.applied.latency, 123, "latency");
      equals(result.applied.downloadThroughput, 5000, "downloadThroughput");
      await call("setNetworkConditions", { preset: "none", tabId: tab }); // don't leak throttling into later tests
      return "custom conditions";
    },

    "setNetworkConditions rejects an unknown preset": async ({ call, tab }) => {
      await rejects(() => call("setNetworkConditions", { preset: "bogus", tabId: tab }), "unknown preset", "setNetworkConditions");
      return "rejected";
    },

    "getHar exports a buffered request as a HAR 1.2 entry": async ({ call, tab, js }) => {
      const token = marker("har");
      await js(`fetch('/ping?tag=${token}').catch(() => {})`);
      const har = await eventually(async () => {
        const h = await call("getHar", { tabId: tab, urlContains: token });
        return h.log.entries.length ? h : false;
      }, { what: "the fetch to appear in the HAR export" });

      equals(har.log.version, "1.2", "HAR version");
      const entry = har.log.entries[0];
      contains(entry.request.url, token, "HAR entry url");
      hasKey(entry, "startedDateTime", "HAR entry");
      hasKey(entry, "timings", "HAR entry");
      return "har entry";
    },

    "getHar returns no entries for a urlContains match with nothing buffered": async ({ call, tab }) => {
      const har = await call("getHar", { tabId: tab, urlContains: "no-such-request-xyz" });
      equals(har.log.entries.length, 0, "har entries");
      return "empty";
    },

    "getEventListeners reports listeners attached to a real element": async ({ call, tab }) => {
      // #btn has pointerdown/mousedown/pointerup/mouseup/click wired individually
      // (for the event-order test) PLUS a separate click listener that increments a
      // counter - two independent click listeners, one each of the rest.
      const result = await call("getEventListeners", { selector: "#btn", tabId: tab });
      isAtLeast(result.listeners.click?.length || 0, 2, "click listener count");
      isAtLeast(result.listeners.mousedown?.length || 0, 1, "mousedown listener count");
      return `${Object.keys(result.listeners).length} event types`;
    },

    "getEventListeners rejects a missing selector": async ({ call, tab }) => {
      await rejects(() => call("getEventListeners", { selector: "#does-not-exist", tabId: tab }), "not found", "getEventListeners");
      return "rejected";
    },
  },
});

// Covers src/tools/observability.js - console, network, page-context evaluation.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, fail, isAtLeast, rejects } from "../lib/assert.js";
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
  },
});

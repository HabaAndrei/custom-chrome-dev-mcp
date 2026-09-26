// Covers src/tools/storage.js - cookies via CDP, localStorage/sessionStorage via evaluate.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, fail, isAtLeast, rejects } from "../lib/assert.js";

/** Unique per run so a leftover cookie/key from another run can never fake a pass. */
const marker = (label) => `cdm-${label}-${Math.random().toString(36).slice(2, 10)}`;

export default defineSuite({
  name: "storage",
  lane: "browser",

  tests: {
    "setCookie writes a cookie that getCookies then returns": async ({ call, tab }) => {
      const name = marker("cookie");
      await call("setCookie", { name, value: "one", tabId: tab });
      const { cookies } = await call("getCookies", { tabId: tab });
      const found = cookies.find((c) => c.name === name);
      if (!found) fail(`getCookies did not return ${name}: ${JSON.stringify(cookies.map((c) => c.name))}`);
      equals(found.value, "one", "cookie value");
      await call("deleteCookie", { name, tabId: tab });
      return "round-tripped";
    },

    "deleteCookie removes just that cookie": async ({ call, tab }) => {
      const name = marker("del");
      await call("setCookie", { name, value: "x", tabId: tab });
      await call("deleteCookie", { name, tabId: tab });
      const { cookies } = await call("getCookies", { tabId: tab });
      if (cookies.some((c) => c.name === name)) fail(`${name} still present after deleteCookie`);
      return "deleted";
    },

    "clearCookies removes every cookie for the tab": async ({ call, tab }) => {
      await call("setCookie", { name: marker("a"), value: "1", tabId: tab });
      await call("setCookie", { name: marker("b"), value: "2", tabId: tab });
      const before = await call("getCookies", { tabId: tab });
      isAtLeast(before.count, 2, "cookies before clear");

      const { cleared } = await call("clearCookies", { tabId: tab });
      isAtLeast(cleared, 2, "cookies cleared");
      const after = await call("getCookies", { tabId: tab });
      equals(after.count, 0, "cookies after clear");
      return `${cleared} cleared`;
    },

    "getStorage returns null for a missing key": async ({ call, tab }) => {
      const { value } = await call("getStorage", { area: "local", key: marker("missing") });
      equals(value, null, "missing key value");
      return "null";
    },

    "setStorageItem + getStorage round-trips a value (local)": async ({ call, tab }) => {
      const key = marker("local");
      await call("setStorageItem", { area: "local", key, value: "hello", tabId: tab });
      const { value } = await call("getStorage", { area: "local", key, tabId: tab });
      equals(value, "hello", "stored value");
      const { entries } = await call("getStorage", { area: "local", tabId: tab });
      contains(entries, key, "entries listing");
      await call("removeStorageItem", { area: "local", key, tabId: tab });
      return "round-tripped";
    },

    "setStorageItem + getStorage round-trips a value (session)": async ({ call, tab }) => {
      const key = marker("session");
      await call("setStorageItem", { area: "session", key, value: "world", tabId: tab });
      const { value } = await call("getStorage", { area: "session", key, tabId: tab });
      equals(value, "world", "stored value");
      await call("removeStorageItem", { area: "session", key, tabId: tab });
      return "round-tripped";
    },

    "removeStorageItem deletes the key": async ({ call, tab }) => {
      const key = marker("remove");
      await call("setStorageItem", { area: "local", key, value: "gone-soon", tabId: tab });
      await call("removeStorageItem", { area: "local", key, tabId: tab });
      const { value } = await call("getStorage", { area: "local", key, tabId: tab });
      equals(value, null, "value after remove");
      return "removed";
    },

    "clearStorage empties every key in that area": async ({ call, tab }) => {
      await call("setStorageItem", { area: "local", key: marker("clear1"), value: "1", tabId: tab });
      await call("setStorageItem", { area: "local", key: marker("clear2"), value: "2", tabId: tab });
      await call("clearStorage", { area: "local", tabId: tab });
      const { entries } = await call("getStorage", { area: "local", tabId: tab });
      equals(Object.keys(entries).length, 0, "keys after clearStorage");
      return "cleared";
    },

    "getStorage rejects an invalid area": async ({ call, tab }) => {
      await rejects(() => call("getStorage", { area: "bogus", tabId: tab }), "area must be", "getStorage");
      return "rejected";
    },
  },
});

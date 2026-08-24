// Covers src/tools/navigation.js — URLs, history, load state.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, isTrue, rejects } from "../lib/assert.js";
import { eventually } from "../lib/wait.js";

export default defineSuite({
  name: "navigation",
  lane: "browser",

  tests: {
    "getUrl reports the fixture page": async ({ call, tab, fixtureUrl }) => {
      const { url } = await call("getUrl", { tabId: tab });
      contains(url, fixtureUrl, "tab url");
      return "on fixture";
    },

    "getTitle reports the page title": async ({ call, tab }) => {
      const { title } = await call("getTitle", { tabId: tab });
      contains(title, "Fixture Page", "tab title");
      return title;
    },

    "waitForLoad resolves once loading completes": async ({ call, tab }) => {
      const result = await call("waitForLoad", { tabId: tab });
      isTrue(result.loaded, "loaded flag");
      return `${result.waitedMs}ms`;
    },

    "navigate replaces the current page": async ({ call, tab, fixtureUrl }) => {
      await call("navigate", { url: `${fixtureUrl}/?page=2`, tabId: tab });
      await call("waitForLoad", { tabId: tab });
      contains((await call("getUrl", { tabId: tab })).url, "page=2", "url after navigate");
      return "navigated";
    },

    "back then forward walk the history": async ({ call, tab, fixtureUrl }) => {
      // Build the two-entry history INSIDE the test, so the result doesn't depend on
      // whatever earlier tests left in this tab's back-stack.
      const settleAt = (marker) =>
        eventually(async () => (await call("getUrl", { tabId: tab })).url.includes(marker), {
          what: `the tab to settle on ${marker}`,
        });

      await call("navigate", { url: `${fixtureUrl}/?page=1`, tabId: tab });
      await call("waitForLoad", { tabId: tab });
      await settleAt("page=1");

      await call("navigate", { url: `${fixtureUrl}/?page=2`, tabId: tab });
      await call("waitForLoad", { tabId: tab });
      await settleAt("page=2");

      // Wait for a POSITIVE url, not merely the absence of page=2. Mid-navigation the
      // tab reports an empty url, which satisfies a negative check instantly — so the
      // old assertion let `forward` fire before `back` had committed, and Chrome
      // answered "Cannot find a next page in history".
      await call("back", { tabId: tab });
      await settleAt("page=1");

      await call("forward", { tabId: tab });
      await settleAt("page=2");
      return "back+forward";
    },

    "reload keeps the tab on the same URL": async ({ call, tab }) => {
      const before = (await call("getUrl", { tabId: tab })).url;
      const result = await call("reload", { tabId: tab });
      isTrue(result.ok, "reload ok");
      await call("waitForLoad", { tabId: tab });
      equals((await call("getUrl", { tabId: tab })).url, before, "url after reload");
      return "reloaded";
    },

    "newtab opens a second tab and leaves this one alone": async ({ call, tab, fixtureUrl }) => {
      const before = (await call("getUrl", { tabId: tab })).url;
      const { created } = await call("newtab", { url: `${fixtureUrl}/?scratch=1` });
      try {
        equals((await call("getUrl", { tabId: tab })).url, before, "original tab url");
        // A freshly created tab reports an empty url until the navigation commits.
        await eventually(async () => (await call("getUrl", { tabId: created })).url.includes("scratch=1"), {
          what: "the new tab to commit its url",
        });
        return `tab ${created}`;
      } finally {
        await call("closeTab", { tabId: created }).catch(() => {});
      }
    },

    "navigate refuses a banlisted host": async ({ call, tab }) => {
      await rejects(() => call("navigate", { url: "https://paypal.com/", tabId: tab }), "banlist", "banlisted navigate");
      return "blocked";
    },

    "expectUrl refuses to act on the wrong page": async ({ call, tab }) => {
      await rejects(() => call("getUrl", { tabId: tab, expectUrl: "definitely-not-this-url" }), "expectUrl", "guard");
      return "guard held";
    },
  },
});

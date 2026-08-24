// Covers src/tools/tabs.js - tab enumeration, focus, pinning, frames.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, fail, isArray, isAtLeast } from "../lib/assert.js";

export default defineSuite({
  name: "tabs",
  lane: "browser",

  tests: {
    "listTabs includes the fixture tab": async ({ call, tab }) => {
      const tabs = await call("listTabs", {});
      isArray(tabs, "listTabs result");
      if (!tabs.some((t) => t.id === tab)) fail(`fixture tab ${tab} missing from listTabs`);
      return `${tabs.length} tabs`;
    },

    "activateTab focuses the requested tab": async ({ call, tab, fixtureUrl }) => {
      const { created } = await call("newtab", { url: `${fixtureUrl}/?other=1` });
      try {
        await call("activateTab", { tabId: tab });
        const active = (await call("listTabs", {})).find((t) => t.active);
        equals(active?.id, tab, "active tab");
        return "focused";
      } finally {
        await call("closeTab", { tabId: created }).catch(() => {});
      }
    },

    "closeTab removes a tab": async ({ call, fixtureUrl }) => {
      const { created } = await call("newtab", { url: `${fixtureUrl}/?doomed=1` });
      await call("closeTab", { tabId: created });
      const stillOpen = (await call("listTabs", {})).some((t) => t.id === created);
      if (stillOpen) fail(`tab ${created} survived closeTab`);
      return "closed";
    },

    "useTab pins a tab and listTabs reports it": async ({ call, tab }) => {
      const pinned = await call("useTab", { tabId: tab });
      equals(pinned.pinned, tab, "pinned tab id");
      const entry = (await call("listTabs", {})).find((t) => t.id === tab);
      if (!entry?.pinned) fail("listTabs does not mark the pinned tab");
      await call("unpinTab", {});
      return "pinned";
    },

    "a pinned tab receives calls that name no tabId": async ({ call, tab, fixtureUrl }) => {
      // Open and focus another tab, then pin the fixture: calls must still reach the
      // fixture even though the OS-active tab is the other one.
      const { created } = await call("newtab", { url: `${fixtureUrl}/?stealer=1` });
      try {
        await call("useTab", { tabId: tab });
        contains((await call("getUrl", {})).url, fixtureUrl, "url with no tabId");
        const url = (await call("getUrl", {})).url;
        if (url.includes("stealer=1")) fail("the background tab hijacked the call despite the pin");
        return "pin held";
      } finally {
        await call("unpinTab", {});
        await call("closeTab", { tabId: created }).catch(() => {});
        await call("activateTab", { tabId: tab }).catch(() => {});
      }
    },

    "unpinTab releases the pin": async ({ call, tab }) => {
      await call("useTab", { tabId: tab });
      const { unpinned } = await call("unpinTab", {});
      equals(unpinned, tab, "unpinned tab id");
      const entry = (await call("listTabs", {})).find((t) => t.id === tab);
      if (entry?.pinned) fail("tab is still marked pinned after unpinTab");
      return "released";
    },

    "listFrames finds the fixture's child frame": async ({ call, tab }) => {
      const { count, frames } = await call("listFrames", { tabId: tab });
      isAtLeast(count, 2, "frame count");
      const child = frames.find((f) => f.frameId !== 0 && f.parentFrameId === 0);
      if (!child) fail(`no child frame in ${JSON.stringify(frames)}`);
      return `${count} frames`;
    },
  },
});

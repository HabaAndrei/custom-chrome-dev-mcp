// Covers src/tools/perception.js - how the agent reads the page.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, fail, hasKey, isAtLeast, rejects } from "../lib/assert.js";

export default defineSuite({
  name: "perception",
  lane: "browser",

  tests: {
    "snapshot returns the page markup": async ({ call, tab }) => {
      const html = await call("snapshot", { tabId: tab });
      contains(html, "Fixture Page", "snapshot html");
      return "markup";
    },

    "snapshotA11y lists interactive elements with refs": async ({ call, tab }) => {
      const outline = await call("snapshotA11y", { tabId: tab });
      const text = typeof outline === "string" ? outline : JSON.stringify(outline);
      contains(text, "ref=", "a11y outline");
      contains(text, "Go Next", "a11y outline");
      return "outline";
    },

    "a ref from snapshotA11y can target an element": async ({ call, tab, prop }) => {
      const outline = await call("snapshotA11y", { tabId: tab });
      const text = typeof outline === "string" ? outline : JSON.stringify(outline);
      // Refs are the whole point of the a11y outline - prove one round-trips.
      const ref = (text.match(/ref=(e\d+)/) || [])[1];
      if (!ref) fail(`no ref found in outline: ${text.slice(0, 120)}`);
      const result = await call("getText", { ref, tabId: tab });
      if (result === undefined || result === null) fail(`ref ${ref} resolved to nothing`);
      return ref;
    },

    "getText reads an element's text": async ({ call, tab }) => {
      contains(await call("getText", { selector: "#title", tabId: tab }), "Fixture Page", "#title text");
      return "read";
    },

    "getText can target by accessible name": async ({ call, tab }) => {
      contains(await call("getText", { name: "Go Next", tabId: tab }), "Go Next", "link text by name");
      return "by name";
    },

    "getAttribute reads an attribute": async ({ call, tab }) => {
      contains(await call("getAttribute", { selector: "#lnk", attr: "href", tabId: tab }), "/next", "href");
      return "href";
    },

    "getAttribute falls back to the live DOM property": async ({ call, tab }) => {
      // #inp has no value="" attribute set after typing - only the property changes.
      await call("fill", { selector: "#inp", text: "live-value", tabId: tab });
      contains(await call("getAttribute", { selector: "#inp", attr: "value", tabId: tab }), "live-value", "value property");
      return "property";
    },

    "queryAll returns every match at once": async ({ call, tab }) => {
      const result = await call("queryAll", { selector: "input", tabId: tab });
      // The tool's documented shape is {count, items} - accept that first.
      const list = Array.isArray(result) ? result : result?.items ?? result?.results ?? result?.elements;
      if (!Array.isArray(list)) fail(`queryAll returned a non-list: ${JSON.stringify(result).slice(0, 120)}`);
      isAtLeast(list.length, 3, "input count");
      return `${list.length} inputs`;
    },

    "viewport reports the metrics screenshots are mapped with": async ({ call, tab }) => {
      const view = await call("viewport", { tabId: tab });
      hasKey(view, "devicePixelRatio", "viewport");
      hasKey(view, "cssViewport", "viewport");
      return `dpr=${view.devicePixelRatio}`;
    },

    "reading a missing element fails loudly": async ({ call, tab }) => {
      await rejects(() => call("getText", { selector: "#does-not-exist", tabId: tab }), undefined, "missing element");
      return "rejected";
    },

    "frameId reads inside the child frame": async ({ call, tab }) => {
      const { frames } = await call("listFrames", { tabId: tab });
      const child = frames.find((f) => f.frameId !== 0 && f.parentFrameId === 0);
      if (!child) fail("no child frame to target");
      contains(await call("getText", { selector: "#fmsg", tabId: tab, frameId: child.frameId }), "inner frame", "frame text");
      return `frame ${child.frameId}`;
    },
  },
});

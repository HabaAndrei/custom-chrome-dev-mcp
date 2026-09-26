// Covers src/tools/trusted-input.js - the CDP path that makes this read as human.
//
// The distinguishing assertion here is `isTrusted`: these tests don't just check that
// something happened, they check the page saw a REAL event. That is the property the
// whole project exists for, so it gets tested directly.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, isAtLeast, isTrue, rejects } from "../lib/assert.js";
import { eventually } from "../lib/wait.js";

export default defineSuite({
  name: "trusted-input",
  lane: "browser",

  tests: {
    "realClick fires the handler": async ({ call, tab, propBecomes }) => {
      await call("realClick", { selector: "#btn", tabId: tab });
      await propBecomes("#out", "textContent", "clicked");
      return "clicked";
    },

    "realClick delivers isTrusted=true": async ({ call, tab, js }) => {
      // The whole point of the CDP path - a synthetic click would report false.
      await js("window.__trusted = null; document.getElementById('btn').addEventListener('click', (e) => { window.__trusted = e.isTrusted; }, { once: true })");
      await call("realClick", { selector: "#btn", tabId: tab });
      const trusted = await eventually(async () => (await js("window.__trusted")) !== "null" ? js("window.__trusted") : false, { what: "the click event to arrive" });
      equals(trusted, "true", "event.isTrusted");
      return "isTrusted=true";
    },

    "synthetic click reports isTrusted=false": async ({ call, tab, js }) => {
      // The contrast that proves the previous test measures something real.
      await js("window.__trusted = null; document.getElementById('btn').addEventListener('click', (e) => { window.__trusted = e.isTrusted; }, { once: true })");
      await call("click", { selector: "#btn", tabId: tab });
      const trusted = await eventually(async () => (await js("window.__trusted")) !== "null" ? js("window.__trusted") : false, { what: "the click event to arrive" });
      equals(trusted, "false", "event.isTrusted");
      return "isTrusted=false";
    },

    "realClick accepts explicit coordinates": async ({ call, tab, js }) => {
      const box = JSON.parse(await js("JSON.stringify(document.getElementById('btn').getBoundingClientRect())"));
      await call("realClick", { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), tabId: tab });
      await eventually(async () => (await js("document.getElementById('out').textContent")) === "clicked", { what: "the click to land" });
      return "by x,y";
    },

    "realClick holds buttons=1 through the press": async ({ call, tab, js }) => {
      // The trusted path has the same buttons obligation as the synthetic one: a
      // mousedown that claims no button is down is self-contradictory.
      await call("realClick", { selector: "#btn", tabId: tab });
      const down = await eventually(
        async () => (await js("(window.__events.find(e => e.type === 'mousedown') || {}).buttons")) || false,
        { what: "a trusted mousedown to arrive" },
      );
      equals(down, "1", "mousedown buttons");
      return "buttons=1";
    },

    "realClick fires the handler exactly once": async ({ call, tab, js }) => {
      await call("realClick", { selector: "#btn", tabId: tab });
      await eventually(async () => (await js("window.__clicks")) === "1", { what: "exactly one click" });
      equals(await js("window.__clicks"), "1", "handler invocation count");
      return "1 invocation";
    },

    "realType enters text into a focused field": async ({ call, tab, prop }) => {
      await call("realType", { selector: "#fin", text: "world", tabId: tab });
      equals(await prop("#fin", "value"), "world", "#fin value");
      return "typed";
    },

    "realType emits one real keydown PER character": async ({ call, tab, js }) => {
      // Input.insertText dropped the whole string in with zero key events, so
      // search-as-you-type boxes and character counters never fired. Four characters
      // in must mean four trusted keydowns out.
      await call("realType", { selector: "#fin", text: "abcd", delay: 0, tabId: tab });
      await eventually(async () => Number(await js("window.__keydowns.length")) >= 4, { what: "four keydowns" });
      equals(await js("window.__keydowns.length"), "4", "keydown count");
      equals(await js("window.__keydowns.map(k => k.key).join('')"), "abcd", "keys in order");
      equals(await js("window.__keydowns.every(k => k.isTrusted)"), "true", "every keydown trusted");
      return "4 trusted keydowns";
    },

    "press sends individual keys": async ({ call, tab, prop }) => {
      await call("press", { selector: "#ta", keys: ["a", "b"], tabId: tab });
      equals(await prop("#ta", "value"), "ab", "#ta value");
      return "ab";
    },

    "press delivers a real keydown": async ({ call, tab, js }) => {
      await js("window.__key = null; document.getElementById('ta').addEventListener('keydown', (e) => { window.__key = e.key + ':' + e.isTrusted; }, { once: true })");
      await call("press", { selector: "#ta", keys: "Enter", tabId: tab });
      const seen = await eventually(async () => (await js("window.__key")) !== "null" ? js("window.__key") : false, { what: "the keydown to arrive" });
      equals(seen, "Enter:true", "keydown key:isTrusted");
      return "Enter, trusted";
    },

    "press rejects an unknown key name": async ({ call, tab }) => {
      await rejects(() => call("press", { keys: "NotARealKey", tabId: tab }), "unknown key", "press");
      return "rejected";
    },

    "hover fires :hover on an element": async ({ call, tab, propBecomes }) => {
      await call("hover", { selector: "#hoverbox", tabId: tab });
      await propBecomes("#hoverout", "textContent", "hovered");
      return "hovered";
    },

    "drag moves across a 420px gap": async ({ call, tab, propBecomes }) => {
      // from and to are far enough apart that both centres cannot be on screen at once -
      // this is the case that caught a real scroll-invalidation bug.
      await call("drag", { from: { selector: "#drag" }, to: { selector: "#drop" }, tabId: tab });
      await propBecomes("#drop", "textContent", "dropped");
      return "dropped";
    },

    "drag glides instead of teleporting": async ({ call, tab, js }) => {
      // One jump move is what HTML5 drag and most JS drag libraries refuse to treat
      // as a drag at all - they need to observe motion between press and release,
      // with the button reported as held.
      await call("drag", { from: { selector: "#drag" }, to: { selector: "#drop" }, tabId: tab });
      const moves = Number(await eventually(
        async () => (await js("window.__moves")) !== "0" ? js("window.__moves") : false,
        { what: "held-button mousemoves during the drag" },
      ));
      isAtLeast(moves, 2, "mousemove events with the button held");
      return moves + " moves";
    },

    "uploadFile sets files without the OS picker": async ({ call, tab, uploadPath, js }) => {
      await call("uploadFile", { selector: "#file", paths: [uploadPath], tabId: tab });
      await eventually(async () => (await js("window.__files")) === "1", { what: "the file input to report one file" });
      return "1 file";
    },

    "uploadFile rejects a missing input": async ({ call, tab, uploadPath }) => {
      await rejects(() => call("uploadFile", { selector: "#no-such-input", paths: [uploadPath], tabId: tab }), "not found", "uploadFile");
      return "rejected";
    },

    "setViewport emulates a narrow device": async ({ call, tab, js }) => {
      await call("setViewport", { width: 400, height: 800, tabId: tab });
      try {
        await eventually(async () => Number(await js("window.innerWidth")) <= 430, { what: "the viewport to narrow" });
        return "400px";
      } finally {
        await call("setViewport", { width: 1280, height: 900, tabId: tab }).catch(() => {});
      }
    },

    "handleDialog auto-answers a confirm": async ({ call, tab, propBecomes }) => {
      await call("handleDialog", { accept: true, tabId: tab });
      await call("realClick", { selector: "#dlgbtn", tabId: tab });
      await propBecomes("#dlgout", "textContent", "confirmed");
      return "confirmed";
    },

    "handleDialog can dismiss instead": async ({ call, tab, propBecomes }) => {
      await call("handleDialog", { accept: false, tabId: tab });
      await call("realClick", { selector: "#dlgbtn", tabId: tab });
      await propBecomes("#dlgout", "textContent", "cancelled");
      await call("handleDialog", { accept: true, tabId: tab }); // restore for later tests
      return "cancelled";
    },

    "setCPUThrottling actually slows down a CPU-bound loop": async ({ call, tab, js }) => {
      const loop = "(() => { const t0 = performance.now(); let x = 0; for (let i = 0; i < 20000000; i++) x += Math.sqrt(i); return performance.now() - t0; })()";
      try {
        await call("setCPUThrottling", { rate: 1, tabId: tab });
        const baseline = Number(await js(loop));
        await call("setCPUThrottling", { rate: 4, tabId: tab });
        const throttled = Number(await js(loop));
        isAtLeast(throttled, baseline * 1.3, "throttled loop duration vs baseline");
        return `${baseline.toFixed(0)}ms -> ${throttled.toFixed(0)}ms`;
      } finally {
        await call("setCPUThrottling", { rate: 1, tabId: tab }).catch(() => {});
      }
    },

    "setGeolocation applies and clears an override": async ({ call, tab }) => {
      const applied = await call("setGeolocation", { latitude: 51.5, longitude: -0.12, accuracy: 5, tabId: tab });
      equals(applied.applied.latitude, 51.5, "latitude");
      equals(applied.applied.longitude, -0.12, "longitude");
      const cleared = await call("setGeolocation", { clear: true, tabId: tab });
      isTrue(cleared.cleared, "cleared flag");
      return "applied and cleared";
    },

    "setMediaFeatures overrides prefers-color-scheme": async ({ call, tab, js }) => {
      try {
        await call("setMediaFeatures", { colorScheme: "dark", tabId: tab });
        equals(await js("matchMedia('(prefers-color-scheme: dark)').matches"), "true", "dark match");
        equals(await js("matchMedia('(prefers-color-scheme: light)').matches"), "false", "light match");
        return "dark mode emulated";
      } finally {
        await call("setMediaFeatures", { clear: true, tabId: tab }).catch(() => {});
      }
    },

    "setMediaFeatures overrides prefers-reduced-motion": async ({ call, tab, js }) => {
      try {
        await call("setMediaFeatures", { reducedMotion: "reduce", tabId: tab });
        equals(await js("matchMedia('(prefers-reduced-motion: reduce)').matches"), "true", "reduced-motion match");
        return "reduced motion emulated";
      } finally {
        await call("setMediaFeatures", { clear: true, tabId: tab }).catch(() => {});
      }
    },

    "setMediaFeatures clear reports a cleared flag": async ({ call, tab }) => {
      const result = await call("setMediaFeatures", { clear: true, tabId: tab });
      isTrue(result.cleared, "cleared flag");
      return "cleared";
    },

    "detach removes the debugger banner": async ({ call, tab }) => {
      const result = await call("detach", { tabId: tab });
      isTrue(result.detached, "detached flag");
      // The next CDP call must silently re-attach rather than fail.
      await call("realClick", { selector: "#btn", tabId: tab });
      return "detached, re-attached";
    },
  },
});

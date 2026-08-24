// Covers src/tools/interaction.js — the fast synthetic DOM path.
import { defineSuite } from "../lib/runner.js";
import { contains, equals, isFalse, isTrue, rejects } from "../lib/assert.js";

export default defineSuite({
  name: "interaction",
  lane: "browser",

  tests: {
    "click fires the element's handler": async ({ call, tab, propBecomes }) => {
      await call("click", { selector: "#btn", tabId: tab });
      await propBecomes("#out", "textContent", "clicked");
      return "handled";
    },

    // The regression test for the double-fire. Asserting on #out's text could never
    // have caught it: setting "clicked" twice looks identical to setting it once.
    "click fires the handler EXACTLY once": async ({ call, tab, js, propBecomes }) => {
      await call("click", { selector: "#btn", tabId: tab });
      await propBecomes("#out", "textContent", "clicked");
      equals(await js("window.__clicks"), "1", "handler invocation count");
      return "1 invocation";
    },

    "click emits the full press sequence in order": async ({ call, tab, js }) => {
      // A lone click event leaves mousedown-driven widgets — dropdowns, menus, most
      // component libraries — completely inert.
      await call("click", { selector: "#btn", tabId: tab });
      const seen = await js("window.__events.map(e => e.type).join(',')");
      contains(seen, "pointerdown,mousedown", "pointer/mouse down pair");
      contains(seen, "mouseup,click", "release then click");
      return seen;
    },

    "click reports buttons=1 while the button is down": async ({ call, tab, js }) => {
      // A naive synthetic click leaves buttons at 0 throughout, contradicting the
      // mousedown it is delivering — a cheap thing for a page to check.
      await call("click", { selector: "#btn", tabId: tab });
      equals(await js("window.__events.find(e => e.type === 'mousedown').buttons"), "1", "mousedown buttons");
      equals(await js("window.__events.find(e => e.type === 'click').buttons"), "0", "click buttons");
      return "1 down / 0 up";
    },

    "click also moves focus to the element": async ({ call, tab, js }) => {
      const result = await call("click", { selector: "#inp", tabId: tab });
      isTrue(result.focused, "focused flag");
      equals(await js("document.activeElement.id"), "inp", "activeElement");
      return "focused";
    },

    "type sets an input's value": async ({ call, tab, prop }) => {
      await call("type", { selector: "#inp", text: "hello", tabId: tab });
      equals(await prop("#inp", "value"), "hello", "#inp value");
      return "typed";
    },

    "type works on contenteditable": async ({ call, tab, js }) => {
      await call("type", { selector: "#ce", text: "rich-text", tabId: tab });
      equals(await js("document.getElementById('ce').innerText.trim()"), "rich-text", "#ce text");
      return "rich text";
    },

    "fill sets and verifies in one call": async ({ call, tab, prop }) => {
      const result = await call("fill", { selector: "#fin", text: "filled-ok", tabId: tab });
      isTrue(result.verified, "verified flag");
      equals(await prop("#fin", "value"), "filled-ok", "#fin value");
      return "verified";
    },

    "fill works on contenteditable too": async ({ call, tab }) => {
      const result = await call("fill", { selector: "#ce", text: "ce-filled", tabId: tab });
      isTrue(result.verified, "verified flag");
      return "verified";
    },

    "assert confirms a matching value": async ({ call, tab }) => {
      await call("fill", { selector: "#fin", text: "check-me", tabId: tab });
      const result = await call("assert", { selector: "#fin", value: "check-me", tabId: tab });
      isTrue(result.ok, "assert result");
      return "passed";
    },

    "assert reports a mismatch instead of throwing": async ({ call, tab }) => {
      await call("fill", { selector: "#fin", text: "actual", tabId: tab });
      const result = await call("assert", { selector: "#fin", value: "expected-something-else", tabId: tab });
      isFalse(result.ok, "assert result");
      return "correctly false";
    },

    "select chooses an option by value": async ({ call, tab, prop }) => {
      await call("select", { selector: "#sel", value: "b", tabId: tab });
      equals(await prop("#sel", "value"), "b", "#sel value");
      return "selected";
    },

    "select chooses an option by visible label": async ({ call, tab, prop }) => {
      await call("select", { selector: "#sel", label: "Beta", tabId: tab });
      equals(await prop("#sel", "value"), "b", "#sel value");
      return "by label";
    },

    "check ticks a checkbox": async ({ call, tab, prop }) => {
      await call("check", { selector: "#chk", checked: true, tabId: tab });
      equals(await prop("#chk", "checked"), "true", "#chk checked");
      return "ticked";
    },

    "check toggles once, not twice": async ({ call, tab, prop, js }) => {
      // check() routes through the same sequence as click; a double-fire here would
      // toggle the box straight back to where it started.
      await call("check", { selector: "#chk", checked: true, tabId: tab });
      equals(await prop("#chk", "checked"), "true", "#chk checked after one toggle");
      equals(await js("document.getElementById('chk').checked"), "true", "live checkedness");
      return "toggled once";
    },

    "check unticks an already-ticked box": async ({ call, tab, prop }) => {
      await call("check", { selector: "#chk", checked: true, tabId: tab });
      await call("check", { selector: "#chk", checked: false, tabId: tab });
      equals(await prop("#chk", "checked"), "false", "#chk checked");
      return "unticked";
    },

    "submit submits the owning form": async ({ call, tab, propBecomes }) => {
      await call("submit", { selector: "#frm", tabId: tab });
      await propBecomes("#out2", "textContent", "submitted");
      return "submitted";
    },

    "scroll reaches the bottom of the page": async ({ call, tab, js }) => {
      await call("scroll", { direction: "bottom", tabId: tab });
      isTrue(await js("window.scrollY > 200"), "scrollY after scrolling to bottom");
      return "scrolled";
    },

    "scroll brings an element into view": async ({ call, tab, js }) => {
      await call("scroll", { selector: "#bottom", tabId: tab });
      isTrue(await js("document.getElementById('bottom').getBoundingClientRect().top < window.innerHeight"), "#bottom visibility");
      return "in view";
    },

    "waitForSelector waits for a deferred element": async ({ call, tab }) => {
      // #late appears 600ms after load — an immediate query would miss it.
      const result = await call("waitForSelector", { selector: "#late", timeout: 5000, tabId: tab });
      isTrue(result.found ?? true, "found flag");
      return "appeared";
    },

    "waitForSelector can wait on page text": async ({ call, tab }) => {
      const result = await call("waitForSelector", { text: "Fixture Page", timeout: 5000, tabId: tab });
      isTrue(result.found ?? true, "found flag");
      return "found text";
    },

    "waitForSelector times out with a useful message": async ({ call, tab }) => {
      const message = await rejects(
        () => call("waitForSelector", { text: "NEVER_APPEARS_XYZ", timeout: 800, tabId: tab }),
        "timeout",
        "waitForSelector",
      );
      return message.slice(0, 20);
    },
  },
});

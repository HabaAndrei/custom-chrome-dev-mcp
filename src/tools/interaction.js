// Synthetic (untrusted) DOM interaction, run in the walker's ISOLATED world.
// Fast and enough for most sites; when a page ignores these, reach for the trusted
// CDP equivalents in trusted-input.js (realClick / realType / press).
import { z } from "zod";
import { TARGET, definePassthrough } from "./schemas.js";

export function registerInteractionTools(server) {
  const tool = definePassthrough(server);

  tool("click", "Click an element with the full SYNTHETIC (untrusted) event sequence a real press produces — pointerover/mouseover, pointerdown/mousedown, focus, pointerup/mouseup, click — fired exactly once, so mousedown-driven widgets (dropdowns, menus, most component libraries) respond. Fast and works for most sites; if a site ignores it or requires trusted events, use realClick. Returns {focused}.", { ...TARGET });
  tool("type", "Set a field's value via the native setter (or the editable path for contenteditable) plus input/change events (not real keystrokes). Works for <input>/<textarea> AND rich editors. For trusted keystrokes use realType or press. Returns the resulting {value}.", { ...TARGET, text: z.string() });
  tool("fill", "Focus a field, set its text (auto-handles <input>/<textarea> vs contenteditable), and read it back. verify defaults to true and throws if the field doesn't hold the text afterward. The reliable one-shot way to enter text + confirm it landed — prefer over click-then-type.", { ...TARGET, text: z.string(), verify: z.boolean().optional() });
  tool("assert", "Verify an element's text (substring match) and/or exact value without a screenshot. Returns {ok, checks}. Cheap post-action verification.", { ...TARGET, text: z.string().optional(), value: z.string().optional() });
  tool("scroll", "Scroll a target element into view, or scroll the window in a direction (top/bottom jump to page extremes).", { ...TARGET, direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional(), amount: z.number().optional() });
  tool("select", "Select an option in a <select> by its value or visible label, firing input/change events.", { ...TARGET, value: z.string().optional(), label: z.string().optional() });
  tool("check", "Set a checkbox or radio to the desired checked state, clicking it only if it isn't already there.", { ...TARGET, checked: z.boolean() });
  tool("submit", "Submit the form that owns the target element (requestSubmit). Use when a form has no clickable submit button.", { ...TARGET });
  tool("waitForSelector", "Poll until a target resolves (selector/ref/name) OR a `text` substring appears on the page. Pass exactly one of selector/ref/name/text. Use waitForLoad to wait on full navigation.", { ...TARGET, text: z.string().optional(), timeout: z.number().optional() });
}

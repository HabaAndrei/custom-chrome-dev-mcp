// Synthetic (untrusted) DOM interaction, run in the walker's ISOLATED world.
// Fast and enough for most sites; when a page ignores these, reach for the trusted
// CDP equivalents in trusted-input.js (realClick / realType / press).
import { z } from "zod";
import { TARGET, definePassthrough } from "./schemas.js";

export function registerInteractionTools(server) {
  const tool = definePassthrough(server);

  tool("click", "Synthetic click: full untrusted event sequence (pointerover/down, focus, pointerup, click) so mousedown-driven widgets (dropdowns, menus) respond. Fast, works on most sites. If ignored, use realClick. Returns {focused}.", { ...TARGET });
  tool("type", "Set a field's value via the native setter (input/textarea and contenteditable) plus input/change events - not real keystrokes. Use realType/press for trusted keystrokes. Returns {value}.", { ...TARGET, text: z.string() });
  tool("fill", "Focus + set text + read back to confirm it landed (verify defaults true, throws if not). The reliable text-entry tool - prefer over click-then-type.", { ...TARGET, text: z.string(), verify: z.boolean().optional() });
  tool("assert", "Check an element's text (substring) and/or exact value without a screenshot. Returns {ok, checks} - cheap post-action verification.", { ...TARGET, text: z.string().optional(), value: z.string().optional() });
  tool("scroll", "Scroll a target into view, or scroll the window in a direction (top/bottom jump to page extremes).", { ...TARGET, direction: z.enum(["up", "down", "left", "right", "top", "bottom"]).optional(), amount: z.number().optional() });
  tool("select", "Select a <select> option by value or visible label, firing input/change events.", { ...TARGET, value: z.string().optional(), label: z.string().optional() });
  tool("check", "Set a checkbox/radio to the desired checked state, clicking only if it isn't already there.", { ...TARGET, checked: z.boolean() });
  tool("submit", "Submit the form owning the target element (requestSubmit) - for forms with no clickable submit button.", { ...TARGET });
  tool("setAttribute", "Set an HTML attribute directly (a live DOM edit). Read it back with getAttribute.", { ...TARGET, name: z.string(), value: z.string() });
  tool("removeAttribute", "Remove an HTML attribute from an element.", { ...TARGET, name: z.string() });
  tool("waitForSelector", "Poll until a target (selector/ref/name) resolves OR a `text` substring appears - pass exactly one. Use waitForLoad for full navigation instead.", { ...TARGET, text: z.string().optional(), timeout: z.number().optional() });
}

// Trusted input via the Chrome DevTools Protocol (chrome.debugger).
//
// This is the group that makes the MCP read as a person rather than a script: events
// carry isTrusted=true, focus changes are genuine, and keystrokes go through the same
// path a physical keyboard uses. The cost is a persistent "being debugged" banner on
// the tab — call detach to clear it.
import { z } from "zod";
import { POINT, TARGET, TARGET_OBJECT, definePassthrough } from "./schemas.js";

export function registerTrustedInputTools(server) {
  const tool = definePassthrough(server);

  tool("realClick", "TRUSTED click (isTrusted=true) via CDP at an element's center or explicit x,y; supports right/double click. Use when synthetic click is ignored. Attaches the debugger (shows a banner); not for chrome:// pages.", { ...TARGET, ...POINT, button: z.enum(["left", "middle", "right"]).optional(), clickCount: z.number().optional() });
  tool("realType", "Type text as TRUSTED input via CDP — one real keyDown/keyUp per character, so search-as-you-type, character counters, and per-keystroke validation all fire. Focuses the target first if one is given. Use when synthetic type doesn't register; for individual keys use press. delay is ms between characters (default 18, jittered); pass 0 for maximum speed at the cost of human-looking rhythm.", { ...TARGET, ...POINT, text: z.string(), delay: z.number().optional() });
  tool("press", "Press TRUSTED keys/combos via CDP — e.g. \"Enter\", \"Tab\", \"Meta+c\", [\"ArrowDown\",\"Enter\"] — with modifiers and named keys; optionally focus a target first.", { ...TARGET, keys: z.union([z.string(), z.array(z.string())]) });
  tool("hover", "Move the mouse over an element or point via CDP to fire :hover (reveal menus/tooltips). Attaches the debugger.", { ...TARGET, ...POINT });
  tool("drag", "TRUSTED press-move-release drag from one element/point to another via CDP, gliding through interpolated mousemove steps with the button held — which is what HTML5 drag and most JS drag libraries require to register.", { from: TARGET_OBJECT, to: TARGET_OBJECT });
  tool("uploadFile", "Set files on an <input type=file> via CDP (located by CSS selector; absolute paths), bypassing the OS file picker.", { selector: z.string(), paths: z.array(z.string()) });
  tool("setViewport", "Override the tab's viewport size and device emulation (scale, mobile, user-agent) via CDP — for responsive testing before a screenshot.", { width: z.number(), height: z.number(), deviceScaleFactor: z.number().optional(), mobile: z.boolean().optional(), userAgent: z.string().optional() });
  tool("handleDialog", "Pre-arm an auto-response (accept/dismiss, optional promptText) for the next native alert/confirm/prompt. Set this BEFORE the action that triggers the dialog.", { accept: z.boolean().optional(), promptText: z.string().optional() });
  tool("detach", "Detach the CDP debugger from the active tab (removes the 'being debugged' banner); it re-attaches on the next CDP tool call.", {});
}

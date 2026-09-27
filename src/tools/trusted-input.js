// Trusted input via the Chrome DevTools Protocol (chrome.debugger).
//
// This is the group that makes the MCP read as a person rather than a script: events
// carry isTrusted=true, focus changes are genuine, and keystrokes go through the same
// path a physical keyboard uses. The cost is a persistent "being debugged" banner on
// the tab - call detach to clear it.
import { z } from "zod";
import { POINT, TARGET, TARGET_OBJECT, definePassthrough } from "./schemas.js";

export function registerTrustedInputTools(server) {
  const tool = definePassthrough(server);

  tool("realClick", "Trusted click (isTrusted=true) via CDP, at an element's center or x,y; supports right/double-click. Use when click is ignored. Attaches the debugger (banner); not on chrome:// pages.", { ...TARGET, ...POINT, button: z.enum(["left", "middle", "right"]).optional(), clickCount: z.number().optional() });
  tool("realType", "Trusted per-character keyDown/keyUp via CDP, so search-as-you-type and per-keystroke validation fire. Focuses target first if given. Use when type doesn't register; for individual keys use press. delay = ms/char (default 18, jittered; 0 = fastest, least human).", { ...TARGET, ...POINT, text: z.string(), delay: z.number().optional() });
  tool("press", "Trusted keys/combos via CDP, e.g. \"Enter\", \"Tab\", \"Meta+c\", [\"ArrowDown\",\"Enter\"] - modifiers and named keys; optionally focus a target first.", { ...TARGET, keys: z.union([z.string(), z.array(z.string())]) });
  tool("hover", "Move the real mouse over an element or point via CDP to fire :hover (reveal menus/tooltips). Attaches the debugger.", { ...TARGET, ...POINT });
  tool("drag", "Trusted press-move-release drag via CDP with interpolated mousemove steps and the button held - required by HTML5 drag and most JS drag libraries.", { from: TARGET_OBJECT, to: TARGET_OBJECT });
  tool("uploadFile", "Set files on an <input type=file> via CDP (CSS selector; absolute paths), bypassing the OS file picker.", { selector: z.string(), paths: z.array(z.string()) });
  tool("setViewport", "Emulate a viewport/device via CDP (size, scale, mobile, user-agent) - for responsive testing before a screenshot.", { width: z.number(), height: z.number(), deviceScaleFactor: z.number().optional(), mobile: z.boolean().optional(), userAgent: z.string().optional() });
  tool("setCPUThrottling", "Emulate a slower CPU via CDP. rate = slowdown multiplier (1 = real speed, 4 = 4x slower) - matches DevTools' Performance-panel presets. Good for reproducing jank.", { rate: z.number() });
  tool("setGeolocation", "Override navigator.geolocation via CDP to a fixed position - for testing geo-gated features. Pass latitude/longitude (+ optional accuracy in meters), or clear:true to restore the real location.", { latitude: z.number().optional(), longitude: z.number().optional(), accuracy: z.number().optional(), clear: z.boolean().optional() });
  tool("setMediaFeatures", "Emulate CSS media features via CDP: colorScheme -> prefers-color-scheme, reducedMotion -> prefers-reduced-motion, media -> screen/print. Test dark mode/reduced-motion/print without OS changes. clear:true removes overrides.", { colorScheme: z.enum(["light", "dark", "no-preference"]).optional(), reducedMotion: z.enum(["reduce", "no-preference"]).optional(), media: z.enum(["screen", "print"]).optional(), clear: z.boolean().optional() });
  tool("handleDialog", "Pre-arm an auto-response (accept/dismiss, optional promptText) for the next native alert/confirm/prompt. Set BEFORE the action that triggers the dialog.", { accept: z.boolean().optional(), promptText: z.string().optional() });
  tool("detach", "Detach the CDP debugger from the active tab (clears the 'being debugged' banner); re-attaches on the next CDP call.", {});
}

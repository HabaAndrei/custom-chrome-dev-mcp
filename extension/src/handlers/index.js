// The handler table: every tool name the server can send, mapped to its implementation.
// Each group here pairs with the identically-named file in src/tools/ on the server.
import { navigationHandlers } from "./navigation.js";
import { tabHandlers } from "./tabs.js";
import { perceptionHandlers } from "./perception.js";
import { interactionHandlers } from "./interaction.js";
import { trustedInputHandlers } from "./trusted-input.js";
import { observabilityHandlers } from "./observability.js";
import { captureHandlers } from "./capture.js";

/** The groups, kept addressable so the test suite can check for name collisions. */
export const HANDLER_GROUPS = {
  navigation: navigationHandlers,
  tabs: tabHandlers,
  perception: perceptionHandlers,
  interaction: interactionHandlers,
  trustedInput: trustedInputHandlers,
  observability: observabilityHandlers,
  capture: captureHandlers,
};

// Flattened lookup. Spreading means a name defined in two groups would silently win
// in the last one — test/verify-all.mjs asserts that never happens.
const handlers = Object.assign({}, ...Object.values(HANDLER_GROUPS));

/** Names of every tool this extension can service. */
export const handlerNames = Object.keys(handlers);

/** Route one call from the server to its handler. */
export function dispatch(tool, args) {
  const fn = handlers[tool];
  if (!fn) throw new Error("unknown tool: " + tool);
  return fn(args || {});
}

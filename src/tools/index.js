// The tool registry. Every tool this MCP exposes is registered from exactly one of
// these groups, and each group mirrors a handler file in extension/src/handlers/ -
// adding a tool means touching that pair and nothing else.
import { registerNavigationTools } from "./navigation.js";
import { registerTabTools } from "./tabs.js";
import { registerPerceptionTools } from "./perception.js";
import { registerInteractionTools } from "./interaction.js";
import { registerTrustedInputTools } from "./trusted-input.js";
import { registerObservabilityTools } from "./observability.js";
import { registerCaptureTools } from "./capture.js";
import { registerStorageTools } from "./storage.js";

// Keyed so the test suite can assert these groups line up with the extension's.
const GROUPS = {
  navigation: registerNavigationTools,
  tabs: registerTabTools,
  perception: registerPerceptionTools,
  interaction: registerInteractionTools,
  trustedInput: registerTrustedInputTools,
  observability: registerObservabilityTools,
  capture: registerCaptureTools,
  storage: registerStorageTools,
};

/** Names of the tool groups, in registration order. */
export const TOOL_GROUP_NAMES = Object.keys(GROUPS);

/** Register every tool group on the given McpServer. */
export function registerAllTools(server) {
  for (const register of Object.values(GROUPS)) register(server);
}

// Choosing which tab (and which frame) the other tools act on.
import { z } from "zod";
import { definePassthrough } from "./schemas.js";

export function registerTabTools(server) {
  const tool = definePassthrough(server);

  tool("listTabs", "List every open tab across all windows (id, title, url, active, windowId). Use to find a tabId for activateTab/closeTab.", {});
  tool("activateTab", "Focus a tab (and its window) by id, making it the active tab other tools operate on.", { tabId: z.number() });
  tool("closeTab", "Close the tab with the given id.", { tabId: z.number() });
  tool("useTab", "Pin a working tab (pass tabId, or omit for the current active tab) so every later tool targets it regardless of OS focus - prevents a background tab (e.g. autoplaying video) from hijacking actions. Call unpinTab to release.", {});
  tool("unpinTab", "Release the tab pinned by useTab; tools revert to the active tab.", {});
  tool("listFrames", "Every frame in the tab, including cross-origin iframes, as {frameId, url, origin}. Pass a frameId to snapshotA11y/click/type/etc. to act inside that frame.", {});
}

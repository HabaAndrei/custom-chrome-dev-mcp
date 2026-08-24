// Moving the browser around: URLs, history, and load state.
import { z } from "zod";
import { definePassthrough } from "./schemas.js";

export function registerNavigationTools(server) {
  const tool = definePassthrough(server);

  tool("navigate", "Navigate the ACTIVE tab to a URL, replacing the current page. Rejects banlisted hosts; use newtab to keep the current page.", { url: z.string().url() });
  tool("newtab", "Open a URL in a NEW foreground tab, leaving the current page intact (same host banlist as navigate).", { url: z.string().url() });
  tool("back", "Go back one entry in the active tab's history.", {});
  tool("forward", "Go forward one entry in the active tab's history.", {});
  tool("reload", "Reload the active tab; set hard=true to bypass the cache.", { hard: z.boolean().optional() });
  tool("getUrl", "Return the active tab's current URL (works on internal pages too).", {});
  tool("getTitle", "Return the active tab's current title.", {});
  tool("waitForLoad", "Block until the active tab's load status is complete; use waitForSelector to wait for a specific element or text instead.", { timeout: z.number().optional() });
}

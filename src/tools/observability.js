// What the page did, not just what it looks like: console, network, and page-context
// evaluation. Capture begins when the debugger attaches, so reload after the first
// CDP call to catch load-time activity.
import { z } from "zod";
import { definePassthrough } from "./schemas.js";

export function registerObservabilityTools(server) {
  const tool = definePassthrough(server);

  tool("getConsole", "Buffered console logs/warnings/errors for the tab. Capture starts on debugger attach (first CDP call) - reload after attaching to catch load-time logs. Filter by level; clear:true empties the buffer.", { level: z.string().optional(), limit: z.number().optional(), clear: z.boolean().optional() });
  tool("listNetworkRequests", "Buffered network requests for the tab (method, url, status, type, timing); capture starts on debugger attach. Filter by urlContains, status, or failedOnly.", { urlContains: z.string().optional(), status: z.number().optional(), failedOnly: z.boolean().optional(), limit: z.number().optional() });
  tool("getNetworkRequest", "Full details for one buffered request by requestId (from listNetworkRequests), including request/response headers (omitted from the list view). includeBody:true also fetches the (truncated) response body.", { requestId: z.string(), includeBody: z.boolean().optional() });
  tool("evaluate", "Run a JS expression in the page's real JS context via CDP (bypasses the content-script CSP that blocks eval), awaiting promises. Returns the JSON-stringified result. Not available on chrome:// pages.", { expression: z.string() });
  tool("setNetworkConditions", "Throttle or take the tab offline via CDP - same presets as DevTools' Network panel (preset: offline/slow3g/fast3g/none), or override latency/throughput directly. 'none' clears throttling.", {
    preset: z.enum(["offline", "slow3g", "fast3g", "none"]).optional(),
    offline: z.boolean().optional(),
    latency: z.number().optional(),
    downloadThroughput: z.number().optional(),
    uploadThroughput: z.number().optional(),
  });
  tool("getHar", "Export buffered requests as a HAR 1.2 document (log.entries), matching DevTools' 'Save all as HAR'. Byte/header sizes aren't buffered so those fields are -1 (HAR's 'unknown'). Filter with urlContains; cap with limit.", { urlContains: z.string().optional(), limit: z.number().optional() });
  tool("getEventListeners", "Event listeners on one element via CDP DOMDebugger, matching DevTools' Event Listeners panel: {type: [{useCapture, passive, once}]}. CSS selector only (not ref/name - bypasses the walker's ref map).", { selector: z.string() });
}

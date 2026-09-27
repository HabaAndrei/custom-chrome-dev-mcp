// What the page did, not just what it looks like: console, network, and page-context
// evaluation. Capture begins when the debugger attaches, so reload after the first
// CDP call to catch load-time activity.
import { z } from "zod";
import { definePassthrough } from "./schemas.js";

export function registerObservabilityTools(server) {
  const tool = definePassthrough(server);

  tool("getConsole", "Return buffered console messages, warnings, and errors for the tab. Capture begins when the debugger attaches (a realClick/evaluate/getConsole call), so reload the page after attaching to catch load-time logs. Filter by level; clear:true empties the buffer.", { level: z.string().optional(), limit: z.number().optional(), clear: z.boolean().optional() });
  tool("listNetworkRequests", "Return buffered network requests for the tab (method, url, status, type, timing). Capture begins when the debugger attaches. Filter by urlContains, status, or failedOnly.", { urlContains: z.string().optional(), status: z.number().optional(), failedOnly: z.boolean().optional(), limit: z.number().optional() });
  tool("getNetworkRequest", "Return details for one buffered request by requestId (from listNetworkRequests). includeBody:true also fetches the response body (truncated).", { requestId: z.string(), includeBody: z.boolean().optional() });
  tool("evaluate", "Evaluate a JS expression in the PAGE's real JS context via CDP (bypasses the content-script CSP that blocks eval), await promises, and return the JSON-stringified result. Not available on chrome:// pages.", { expression: z.string() });
  tool("setNetworkConditions", "Emulate network conditions for the tab via the CDP Network domain - the same presets DevTools' Network panel offers. Pass preset ('offline'|'slow3g'|'fast3g'|'none'), and/or override offline/latency(ms)/downloadThroughput/uploadThroughput(bytes per sec). 'none' clears throttling.", {
    preset: z.enum(["offline", "slow3g", "fast3g", "none"]).optional(),
    offline: z.boolean().optional(),
    latency: z.number().optional(),
    downloadThroughput: z.number().optional(),
    uploadThroughput: z.number().optional(),
  });
  tool("getHar", "Export the tab's buffered network requests as a HAR 1.2 document (log.entries) - the same format DevTools' 'Save all as HAR' produces. Best-effort: headers and exact byte sizes aren't buffered, so those fields are approximated (-1, HAR's own 'unknown' sentinel). Filter with urlContains; cap with limit.", { urlContains: z.string().optional(), limit: z.number().optional() });
  tool("getEventListeners", "Return the event listeners attached to one element (by CSS selector only - not ref/name, since this resolves a remote object via the CDP DOMDebugger domain rather than the walker's ref map), matching DevTools' Event Listeners panel: {type: [{useCapture, passive, once}]}.", { selector: z.string() });
}

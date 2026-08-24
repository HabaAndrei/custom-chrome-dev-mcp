// Argument shapes shared across tool groups, plus the passthrough registration helper.
import { z } from "zod";
import { call } from "../relay/hub-client.js";

/** Address one element by CSS selector, walker ref (eN), or accessible name. */
export const TARGET = {
  selector: z.string().optional(),
  ref: z.string().optional(),
  name: z.string().optional(),
};

/**
 * Accepted by EVERY tool:
 *   tabId    — act on a specific tab instead of the ambient active one, so a
 *              background tab can't hijack the action
 *   frameId  — act inside a specific frame from listFrames
 *   expectUrl — guard: refuse if the resolved tab's URL doesn't contain this
 * Pin a tab for a whole session with useTab.
 */
export const TAB_SCOPE = {
  tabId: z.number().optional(),
  frameId: z.number().optional(),
  expectUrl: z.string().optional(),
};

/** Explicit CSS-pixel coordinates, an alternative to resolving an element. */
export const POINT = { x: z.number().optional(), y: z.number().optional() };

/** A target as a nested object (drag takes two of these). */
export const TARGET_OBJECT = z.object({ ...TARGET, ...POINT });

/** Wrap any value as MCP text content. */
export const asText = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

/**
 * Register a passthrough tool: validate args here, forward them to the extension
 * under the same name, return the result as text. Tools that post-process the
 * extension's reply (the capture group) call server.tool directly instead.
 */
export function definePassthrough(server) {
  return (name, description, shape = {}) =>
    server.tool(name, description, { ...shape, ...TAB_SCOPE }, async (args) => asText(await call(name, args)));
}

// Cookies and page storage - the Application-panel equivalents DevTools has. Cookies go
// through the CDP Network domain (visible even for httpOnly cookies the page's own JS
// can't read); localStorage/sessionStorage go through the same Runtime.evaluate path
// evaluate() uses, so they only see what the page itself could see.
import { z } from "zod";
import { definePassthrough } from "./schemas.js";

const AREA = z.enum(["local", "session"]);
const SAME_SITE = z.enum(["Strict", "Lax", "None"]);

export function registerStorageTools(server) {
  const tool = definePassthrough(server);

  tool("getCookies", "Every cookie visible to the tab's current URL, via CDP Network domain (includes httpOnly cookies the page's own JS can't read).");
  tool("setCookie", "Set a cookie via CDP Network domain. url defaults to the tab's current URL; pass domain/path/secure/httpOnly/sameSite/expires to match the cookie you need.", {
    name: z.string(),
    value: z.string(),
    url: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    sameSite: SAME_SITE.optional(),
    expires: z.number().optional(),
  });
  tool("deleteCookie", "Delete one cookie by name. url defaults to the tab's current URL; pass domain/path if the cookie was scoped more narrowly than that.", {
    name: z.string(),
    url: z.string().optional(),
    domain: z.string().optional(),
    path: z.string().optional(),
  });
  tool("clearCookies", "Delete every cookie visible to the tab's current URL - not the whole browser, only what getCookies would return for this tab.");
  tool("getStorage", "Read from localStorage or sessionStorage. Pass key for one value (null if absent), or omit it to get every key/value pair in that area.", { area: AREA, key: z.string().optional() });
  tool("setStorageItem", "Write one key/value pair into localStorage or sessionStorage.", { area: AREA, key: z.string(), value: z.string() });
  tool("removeStorageItem", "Remove one key from localStorage or sessionStorage.", { area: AREA, key: z.string() });
  tool("clearStorage", "Clear every key from localStorage or sessionStorage for the current page.", { area: AREA });
}

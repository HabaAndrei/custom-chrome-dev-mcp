// Screenshots and recordings.
//
// These three are the only tools that don't pass straight through: the extension
// hands back base64, and the server writes the bytes into the capture allowlist so
// no page-supplied path can steer a file elsewhere. Their schemas deliberately take
// only `tabId` (not the full tab scope) — a capture has no frame or URL guard.
import { z } from "zod";
import { CAPTURE_DIR } from "../config.js";
import { writeCapture } from "../capture/capture-path.js";
import { call } from "../relay/hub-client.js";
import { asText } from "./schemas.js";

export function registerCaptureTools(server) {
  server.tool(
    "screenshot",
    `Screenshot the VISIBLE viewport and save it under ${CAPTURE_DIR}, AND return the image inline plus {devicePixelRatio, cssViewport} — so you see it in one call (no separate file read) and can map screenshot pixels to CSS coordinates (cssX = screenshotX / devicePixelRatio). For the whole scrollable page use fullPageScreenshot. 'path' is a filename or a path inside that folder; add tabId to target a specific tab.`,
    { path: z.string().optional(), format: z.enum(["png", "jpeg"]).optional(), tabId: z.number().optional() },
    async ({ path, format, tabId }) => {
      const res = await call("screenshot", { format: format || "png", tabId });
      const isJpeg = format === "jpeg";
      const written = writeCapture(path, isJpeg ? ".jpg" : ".png", res.b64);
      return {
        content: [
          { type: "image", data: res.b64, mimeType: isJpeg ? "image/jpeg" : "image/png" },
          { type: "text", text: JSON.stringify({ ...written, devicePixelRatio: res.devicePixelRatio, cssViewport: res.cssViewport }) },
        ],
      };
    },
  );

  server.tool(
    "fullPageScreenshot",
    `Capture the ENTIRE scrollable page (beyond the visible viewport) via CDP and save it under ${CAPTURE_DIR}. Use screenshot for just the visible area.`,
    { path: z.string().optional(), tabId: z.number().optional() },
    async ({ path, tabId }) => {
      const res = await call("fullPageScreenshot", { tabId });
      return asText(writeCapture(path, ".png", res.b64));
    },
  );

  server.tool(
    "record",
    `Record the active tab to a video via the DevTools protocol (no user gesture needed). action:"start" begins recording the tab's viewport, action:"stop" ends it and saves a .webm under ${CAPTURE_DIR}, action:"status" reports whether recording is in progress. Attaches the debugger (shows a "being debugged" banner) and records the TAB — not the OS desktop, which Chrome cannot capture without a manual screen picker.`,
    { action: z.enum(["start", "stop", "status"]).optional(), path: z.string().optional(), tabId: z.number().optional() },
    async ({ action, path, tabId }) => {
      const res = await call("record", { action: action || "status", tabId });
      if (action !== "stop") return asText(res);
      return asText(writeCapture(path, ".webm", res.b64));
    },
  );
}

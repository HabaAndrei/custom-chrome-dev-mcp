// Screenshots and recordings.
//
// These three are the only tools that don't pass straight through: the extension
// hands back base64, and the server writes the bytes into the capture allowlist so
// no page-supplied path can steer a file elsewhere. Their schemas deliberately take
// only `tabId` (not the full tab scope) - a capture has no frame or URL guard.
import { z } from "zod";
import { CAPTURE_DIR } from "../config.js";
import { writeCapture } from "../capture/capture-path.js";
import { call } from "../relay/hub-client.js";
import { asText } from "./schemas.js";

export function registerCaptureTools(server) {
  server.tool(
    "screenshot",
    `Screenshot the visible viewport - one call, no file read needed. The full-res file is saved under ${CAPTURE_DIR}; a downscaled JPEG comes back inline with {inline: {width, height, scale}, devicePixelRatio, cssViewport} (cssX = inlineX / inline.scale; for the saved file, cssX = fileX / devicePixelRatio). scale is null when the image does not map onto the viewport (e.g. under setViewport emulation). The tab must be the one showing in its window (activateTab a background tab first). Use fullPageScreenshot for the whole scrollable page. path is a filename or path inside that folder.`,
    { path: z.string().optional(), format: z.enum(["png", "jpeg"]).optional(), tabId: z.number().optional() },
    async ({ path, format, tabId }) => {
      const res = await call("screenshot", { format: format || "png", tabId });
      const written = writeCapture(path, format === "jpeg" ? ".jpg" : ".png", res.b64);
      const info = { ...written, devicePixelRatio: res.devicePixelRatio, cssViewport: res.cssViewport };

      // Never inline the full-res capture: device-pixel PNGs can exceed the API's image
      // limits and then break every later request in the conversation.
      const { inline } = res;
      if (!inline) return asText({ ...info, inline: "unavailable - read the saved file" });
      return {
        content: [
          { type: "image", data: inline.b64, mimeType: inline.mimeType },
          { type: "text", text: JSON.stringify({ ...info, inline: { width: inline.width, height: inline.height, scale: inline.scale } }) },
        ],
      };
    },
  );

  server.tool(
    "fullPageScreenshot",
    `Capture the entire scrollable page (beyond the visible viewport) via CDP, saved under ${CAPTURE_DIR}. Use screenshot for just the visible area.`,
    { path: z.string().optional(), tabId: z.number().optional() },
    async ({ path, tabId }) => {
      const res = await call("fullPageScreenshot", { tabId });
      return asText(writeCapture(path, ".png", res.b64));
    },
  );

  server.tool(
    "record",
    `Record the active tab to .webm via CDP screencast (no user gesture needed). action: start/stop/status; stop saves under ${CAPTURE_DIR}. Attaches the debugger (banner). Records the tab, not the OS desktop.`,
    { action: z.enum(["start", "stop", "status"]).optional(), path: z.string().optional(), tabId: z.number().optional() },
    async ({ action, path, tabId }) => {
      const res = await call("record", { action: action || "status", tabId });
      if (action !== "stop") return asText(res);
      return asText(writeCapture(path, ".webm", res.b64));
    },
  );
}

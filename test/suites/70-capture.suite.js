// Covers src/tools/capture.js - screenshots and recording.
//
// These assert on file MAGIC BYTES, not just on a non-empty response: a "screenshot"
// that is really an error string would otherwise pass.
import fs from "node:fs";
import path from "node:path";
import { defineSuite } from "../lib/runner.js";
import { equals, isAtLeast, isFalse, isJpeg, isPng, isTrue, isWebm, rejects } from "../lib/assert.js";
import { sleep } from "../lib/wait.js";
import { INLINE_SHOT_MAX_EDGE, INLINE_SHOT_MAX_PIXELS } from "../../extension/src/config.js";

const decode = (b64) => Buffer.from(b64, "base64");

export default defineSuite({
  name: "capture",
  lane: "browser",
  timeout: 60000, // recording needs real wall-clock time

  tests: {
    "screenshot returns a valid PNG": async ({ call, tab, artifacts }) => {
      const shot = await call("screenshot", { format: "png", tabId: tab });
      const bytes = decode(shot.b64);
      isPng(bytes, "screenshot");
      fs.writeFileSync(path.join(artifacts, "viewport.png"), bytes);
      return `${Math.round(bytes.length / 1024)}KB`;
    },

    "screenshot carries the metadata needed to map pixels": async ({ call, tab }) => {
      const shot = await call("screenshot", { format: "png", tabId: tab });
      // Without these a caller cannot convert screenshot px to the CSS px realClick uses.
      isAtLeast(shot.devicePixelRatio, 1, "devicePixelRatio");
      if (!shot.cssViewport) throw new Error("screenshot returned no cssViewport");
      return `dpr=${shot.devicePixelRatio}`;
    },

    "screenshot's inline copy stays within the API image limits": async ({ call, tab }) => {
      const shot = await call("screenshot", { format: "png", tabId: tab });
      // The full-res capture can pass 5MB; inlining it breaks every later API request.
      if (!shot.inline) throw new Error("screenshot returned no inline copy");
      const { b64, mimeType, width, height, scale } = shot.inline;
      equals(mimeType, "image/jpeg", "inline mimeType");
      isJpeg(decode(b64), "inline copy");
      isTrue(Math.max(width, height) <= INLINE_SHOT_MAX_EDGE, `inline edge ${Math.max(width, height)} <= ${INLINE_SHOT_MAX_EDGE}`);
      isTrue(width * height <= INLINE_SHOT_MAX_PIXELS, `inline area ${width * height} <= ${INLINE_SHOT_MAX_PIXELS}`);
      // Never larger than CSS size, and the scale must map it back onto the viewport.
      isTrue(width <= shot.cssViewport.width, `inline width ${width} <= css width ${shot.cssViewport.width}`);
      isTrue(Math.abs(width / scale - shot.cssViewport.width) <= 1, "inline.scale maps back to css width");
      return `${width}x${height} ${Math.round(b64.length / 1024)}KB b64, scale=${scale.toFixed(3)}`;
    },

    "fullPageScreenshot captures beyond the viewport": async ({ call, tab, artifacts }) => {
      const shot = await call("fullPageScreenshot", { tabId: tab });
      const bytes = decode(shot.b64);
      isPng(bytes, "full-page screenshot");
      fs.writeFileSync(path.join(artifacts, "fullpage.png"), bytes);
      return `${Math.round(bytes.length / 1024)}KB`;
    },

    "record reports idle before starting": async ({ call, tab }) => {
      const status = await call("record", { action: "status", tabId: tab });
      isFalse(status.recording, "recording flag");
      return "idle";
    },

    "record captures a real WebM without any user gesture": async ({ call, tab, artifacts }) => {
      // No toolbar click anywhere in this test - that is the point. Recording runs on
      // CDP screencast precisely because an MCP call has no user gesture.
      const started = await call("record", { action: "start", tabId: tab });
      isTrue(started.recording, "recording flag after start");

      // Give the screencast something to encode: scroll the page for ~2.5s.
      await call("scroll", { direction: "bottom", tabId: tab }).catch(() => {});
      await sleep(1200);
      await call("scroll", { direction: "top", tabId: tab }).catch(() => {});
      await sleep(1200);

      const stopped = await call("record", { action: "stop", tabId: tab }, 45000);
      const bytes = decode(stopped.b64);
      isWebm(bytes, "recording");
      fs.writeFileSync(path.join(artifacts, "recording.webm"), bytes);
      return `${Math.round(bytes.length / 1024)}KB WebM`;
    },

    "record rejects a stop when nothing is recording": async ({ call, tab }) => {
      await rejects(() => call("record", { action: "stop", tabId: tab }), "not recording", "record stop");
      return "rejected";
    },

    "record returns to idle after stopping": async ({ call, tab }) => {
      const status = await call("record", { action: "status", tabId: tab });
      isFalse(status.recording, "recording flag");
      return "idle";
    },
  },
});

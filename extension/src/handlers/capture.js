// Mirrors src/tools/capture.js on the server.
//
// These return base64 rather than writing anything: the server owns the filesystem
// side so every write lands inside its capture allowlist.
import { resolveTab } from "../tabs.js";
import { runWalker } from "../walker-bridge.js";
import { cdp, ensureAttached } from "../cdp/session.js";
import { isRecording, startRecording, stopRecording } from "../recording/recorder.js";
import { INLINE_SHOT_MAX_EDGE, INLINE_SHOT_MAX_PIXELS } from "../config.js";

const META = { requireScriptable: false };

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

// The capture is in device pixels (3024x1720 on a 2x Retina, 3840+ wide on a 4K
// Windows screen), and a PNG of that can pass 5MB. Inline, that is more than the API
// accepts - and once it is in the conversation every later request carries it. So the
// model gets a JPEG no larger than CSS size and within the API's no-resample bounds;
// `scale` is inline px per CSS px (cssX = inlineX / scale).
async function inlineCopy(dataUrl, meta) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const { width, height } = bitmap;
  const factor = Math.min(
    1,
    1 / (meta.devicePixelRatio || 1),
    INLINE_SHOT_MAX_EDGE / Math.max(width, height),
    Math.sqrt(INLINE_SHOT_MAX_PIXELS / (width * height)),
  );
  const w = Math.max(1, Math.round(width * factor));
  const h = Math.max(1, Math.round(height * factor));

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  const cssWidth = meta.cssViewport?.width;
  return {
    b64: toB64(await blob.arrayBuffer()),
    mimeType: "image/jpeg",
    width: w,
    height: h,
    scale: cssWidth ? w / cssWidth : null,
  };
}

export const captureHandlers = {
  async screenshot(a = {}) {
    const format = a.format || "png";
    const tab = await resolveTab(a, META);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format });

    // devicePixelRatio + CSS viewport let callers convert screenshot pixels (device px)
    // to the CSS px realClick/x,y use: cssX = screenshotX / devicePixelRatio.
    let meta = {};
    try { meta = await runWalker(tab.id, "viewport", {}); } catch {}

    // b64 is the full-res file for disk; only `inline` is ever shown to the model, and
    // the server sends no image at all if it could not be made.
    let inline = null;
    try { inline = await inlineCopy(dataUrl, meta); } catch {}

    return { b64: dataUrl.split(",")[1], format, inline, ...meta };
  },

  async fullPageScreenshot(a = {}) {
    const tab = await resolveTab(a, META);
    await ensureAttached(tab.id);

    const metrics = await cdp(tab.id, "Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    const shot = await cdp(tab.id, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 },
    });
    return { b64: shot.data, format: "png" };
  },

  async record(a = {}) {
    const action = a.action || "status";
    if (action === "start") return startRecording(await resolveTab(a));
    if (action === "stop") return stopRecording(); // { b64, mimeType, bytes }
    return { recording: isRecording() };
  },
};

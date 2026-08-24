// Mirrors src/tools/capture.js on the server.
//
// These return base64 rather than writing anything: the server owns the filesystem
// side so every write lands inside its capture allowlist.
import { resolveTab } from "../tabs.js";
import { runWalker } from "../walker-bridge.js";
import { cdp, ensureAttached } from "../cdp/session.js";
import { isRecording, startRecording, stopRecording } from "../recording/recorder.js";

const META = { requireScriptable: false };

export const captureHandlers = {
  async screenshot(a = {}) {
    const format = a.format || "png";
    const tab = await resolveTab(a, META);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format });

    // devicePixelRatio + CSS viewport let callers convert screenshot pixels (device px)
    // to the CSS px realClick/x,y use: cssX = screenshotX / devicePixelRatio.
    let meta = {};
    try { meta = await runWalker(tab.id, "viewport", {}); } catch {}

    return { b64: dataUrl.split(",")[1], format, ...meta };
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

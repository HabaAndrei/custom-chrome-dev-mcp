// Gesture-free tab recording.
//
// chrome.tabCapture needs a user gesture, which an MCP call never has. So we use the
// DevTools protocol instead (the debugger is already attached for trusted input, and
// CDP needs no gesture): Page.startScreencast streams JPEG frames of the tab's
// viewport, the worker relays them to the offscreen document, and there a <canvas> +
// canvas.captureStream() + MediaRecorder encode a real .webm.
import { OFFSCREEN_PAGE } from "../config.js";
import { cdp, ensureAttached } from "../cdp/session.js";

let recording = false;
let recordingTabId = null;

export const isRecording = () => recording;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PAGE,
      reasons: ["USER_MEDIA"],
      justification: "Encode a tab recording into a video file.",
    });
  } catch (e) {
    // A racing call may have created it first; anything else is a real failure.
    if (!/single offscreen/i.test(String(e.message || e))) throw e;
  }
}

const toOffscreen = (msg) => chrome.runtime.sendMessage({ target: "offscreen", ...msg });

/** Relay each screencast frame to the encoder, then ack so the next frame is sent. */
export function installRecordingListener() {
  chrome.debugger.onEvent.addListener((src, method, params) => {
    if (method !== "Page.screencastFrame" || !recording || src.tabId !== recordingTabId) return;
    toOffscreen({ type: "rec-frame", data: params.data }).catch(() => {});
    cdp(recordingTabId, "Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => {});
  });
}

export async function startRecording(tab) {
  if (recording) throw new Error("already recording");

  await ensureAttached(tab.id);
  await ensureOffscreen();

  const res = await toOffscreen({ type: "rec-start", fps: 15 });
  if (res && res.error) throw new Error("offscreen: " + res.error);

  await cdp(tab.id, "Page.enable");
  await cdp(tab.id, "Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 1600, maxHeight: 1200, everyNthFrame: 1 });

  recording = true;
  recordingTabId = tab.id;
  setBadge(true);
  return { recording: true };
}

/** @returns {Promise<{b64: string, mimeType: string, bytes: number}>} */
export async function stopRecording() {
  if (!recording) throw new Error("not recording");

  try { await cdp(recordingTabId, "Page.stopScreencast"); } catch {}
  const res = await toOffscreen({ type: "rec-stop" });

  recording = false;
  recordingTabId = null;
  setBadge(false);

  if (res && res.error) throw new Error("offscreen: " + res.error);
  return res;
}

function setBadge(on) {
  chrome.action.setBadgeText({ text: on ? "REC" : "" });
  if (on) chrome.action.setBadgeBackgroundColor({ color: "#d00000" });
  chrome.action.setTitle({ title: on ? "Custom-chrome-dev-mcp - recording tab (MCP)" : "Custom-chrome-dev-mcp" });
}

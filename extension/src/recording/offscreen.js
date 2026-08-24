// Offscreen document: encodes CDP screencast frames into a WebM (the service worker
// has no DOM/canvas). The worker relays each tab frame as a base64 JPEG; we paint it
// onto a <canvas>, whose captureStream() feeds a MediaRecorder that produces the video.
let recorder = null;
let chunks = [];
let canvas = null;
let ctx = null;
let stream = null;

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function recStart(fps) {
  canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720; // resized to the first real frame
  ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  stream = canvas.captureStream(fps || 15);
  chunks = [];
  const preferred = "video/webm;codecs=vp9";
  const mimeType = MediaRecorder.isTypeSupported(preferred) ? preferred : "video/webm";
  recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.start(1000); // flush a chunk every second
}

async function recFrame(dataB64) {
  if (!ctx || !canvas) return;
  const bmp = await createImageBitmap(b64ToBlob(dataB64, "image/jpeg"));
  if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
    canvas.width = bmp.width;
    canvas.height = bmp.height;
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
}

function recStop() {
  return new Promise((resolve, reject) => {
    if (!recorder) return reject(new Error("not recording"));
    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: "video/webm" });
        const buf = await blob.arrayBuffer();
        const b64 = toB64(buf);
        if (stream) stream.getTracks().forEach((t) => t.stop());
        recorder = null; chunks = []; canvas = null; ctx = null; stream = null;
        resolve({ b64, mimeType: "video/webm", bytes: buf.byteLength });
      } catch (e) { reject(e); }
    };
    // Give the encoder a beat to flush the final drawn frame, then stop.
    setTimeout(() => { try { recorder.stop(); } catch (e) { reject(e); } }, 150);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;
  if (msg.type === "rec-start") {
    recStart(msg.fps).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: String(e?.message || e) }));
    return true;
  }
  if (msg.type === "rec-frame") {
    recFrame(msg.data).catch(() => {});
    return false; // fire-and-forget; no response
  }
  if (msg.type === "rec-stop") {
    recStop().then((r) => sendResponse(r)).catch((e) => sendResponse({ error: String(e?.message || e) }));
    return true;
  }
});

// Extension-side constants. AUTH_TOKEN and the port must match src/config.js on the
// server; the hub drops any peer that presents a different token.
export const WS_URL = "ws://127.0.0.1:9876";
export const AUTH_TOKEN = "bmcp-7f3a9c2e5d14";
export const BUILD = "0.4.0";

/** Sub-30s so it beats the MV3 idle teardown - see connection.js. */
export const HEARTBEAT_MS = 20000;
export const RECONNECT_MS = 1500;

/** Hosts this extension refuses to drive, however it is asked. */
export const BANLIST = [
  /^https?:\/\/([^/]+\.)?your-bank\.com\//i,
  /^https?:\/\/([^/]+\.)?paypal\.com\//i,
  /^https?:\/\/mail\.google\.com\//i,
];

/** Per-tab ring buffer cap for console entries and network records. */
export const BUFFER_CAP = 500;

/**
 * Bounds for the screenshot copy returned inline to the model (the saved file stays
 * full resolution). The API resamples anything past ~1568px or ~1.15MP itself, which
 * would silently break the reported coordinate scale - see handlers/capture.js.
 */
export const INLINE_SHOT_MAX_EDGE = 1568;
export const INLINE_SHOT_MAX_PIXELS = 1_150_000;

/** Path (extension-root relative) of the script injected into pages. */
export const WALKER_FILE = "src/page/walker.js";

/** Path (extension-root relative) of the offscreen recorder document. */
export const OFFSCREEN_PAGE = "src/recording/offscreen.html";

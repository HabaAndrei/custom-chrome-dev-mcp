// Per-tab observability ring buffers, filled from CDP events once the debugger
// attaches. Capped so a long-lived tab can never grow them without bound.
import { BUFFER_CAP } from "../config.js";

/** tabId -> [{source, level, text, url, ts}] */
const consoleBuf = new Map();
/** tabId -> Map(requestId -> {method, url, type, status, ...}) */
const networkBuf = new Map();

const argToString = (a) => (a && a.value !== undefined ? String(a.value) : a?.description || a?.type || "");

function pushConsole(tabId, entry) {
  let arr = consoleBuf.get(tabId);
  if (!arr) { arr = []; consoleBuf.set(tabId, arr); }
  arr.push(entry);
  if (arr.length > BUFFER_CAP) arr.shift();
}

function networkFor(tabId) {
  let m = networkBuf.get(tabId);
  if (!m) { m = new Map(); networkBuf.set(tabId, m); }
  return m;
}

/** Drop everything buffered for a tab (it detached or closed). */
export function clearBuffers(tabId) {
  consoleBuf.delete(tabId);
  networkBuf.delete(tabId);
}

export const getConsoleEntries = (tabId) => consoleBuf.get(tabId) || [];
export const resetConsole = (tabId) => consoleBuf.set(tabId, []);
export const getNetworkRecords = (tabId) => networkBuf.get(tabId) || new Map();

/** Subscribe to the CDP events that feed both buffers. Called once at startup. */
export function installBufferListeners() {
  chrome.debugger.onEvent.addListener((src, method, params) => {
    const tabId = src.tabId;
    if (tabId == null) return;

    switch (method) {
      case "Runtime.consoleAPICalled":
        pushConsole(tabId, { source: "console", level: params.type, text: (params.args || []).map(argToString).join(" "), ts: params.timestamp });
        break;

      case "Log.entryAdded": {
        const e = params.entry || {};
        pushConsole(tabId, { source: e.source || "log", level: e.level, text: e.text, url: e.url, ts: e.timestamp });
        break;
      }

      case "Runtime.exceptionThrown": {
        const d = params.exceptionDetails || {};
        pushConsole(tabId, { source: "exception", level: "error", text: d.exception?.description || d.text, url: d.url, ts: params.timestamp });
        break;
      }

      case "Network.requestWillBeSent": {
        const m = networkFor(tabId);
        // timestamp is CDP's monotonic clock (for measuring elapsed time); wallTime is
        // real UTC seconds (for HAR's startedDateTime) - neither substitutes for the other.
        m.set(params.requestId, {
          requestId: params.requestId, method: params.request?.method, url: params.request?.url, type: params.type,
          ts: params.timestamp, wallTime: params.wallTime, requestHeaders: params.request?.headers || {},
        });
        if (m.size > BUFFER_CAP) m.delete(m.keys().next().value);
        break;
      }

      case "Network.responseReceived": {
        const rec = networkBuf.get(tabId)?.get(params.requestId);
        if (rec) {
          rec.status = params.response?.status;
          rec.mimeType = params.response?.mimeType;
          rec.type = params.type || rec.type;
          rec.respTs = params.timestamp;
          rec.responseHeaders = params.response?.headers || {};
        }
        break;
      }

      case "Network.loadingFinished": {
        const rec = networkBuf.get(tabId)?.get(params.requestId);
        if (rec) { rec.finishedTs = params.timestamp; rec.encodedDataLength = params.encodedDataLength; }
        break;
      }

      case "Network.loadingFailed": {
        const rec = networkBuf.get(tabId)?.get(params.requestId);
        if (rec) { rec.failed = true; rec.errorText = params.errorText; rec.finishedTs = params.timestamp; }
        break;
      }
    }
  });
}

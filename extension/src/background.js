// custom-chrome-dev-mcp extension — MV3 service worker entry point.
//
// This file only wires things together; the behaviour lives in the modules below.
//   config.js        constants shared across the extension
//   connection.js    the hub socket and the heartbeat that keeps MV3 from idling out
//   tabs.js          which tab a call acts on, and whether it is allowed to
//   walker-bridge.js the channel to the injected page script (page/walker.js)
//   cdp/             debugger session, keyboard, dialogs, observability buffers
//   recording/       gesture-free tab recording via CDP screencast
//   handlers/        one file per tool group, mirroring src/tools/ on the server
//
// The toolbar icon is intentionally INERT — there is no onClicked handler and no
// popup, so a click can never start a recording. Recording happens only through the
// MCP `record` tool.
import { startConnection } from "./connection.js";
import { dispatch } from "./handlers/index.js";
import { installSessionListeners } from "./cdp/session.js";
import { installBufferListeners } from "./cdp/buffers.js";
import { installDialogListener } from "./cdp/dialogs.js";
import { installRecordingListener } from "./recording/recorder.js";

// Chrome delivers events to whichever listeners exist when the worker starts, so all
// of these must be registered synchronously at the top level of the entry module.
installSessionListeners();
installBufferListeners();
installDialogListener();
installRecordingListener();

startConnection(dispatch);

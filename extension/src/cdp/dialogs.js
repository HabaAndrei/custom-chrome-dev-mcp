// Native alert/confirm/prompt auto-handling.
//
// A dialog blocks the page until something answers it, and an MCP call can't click
// one. So handleDialog pre-arms a policy and this listener answers on its behalf.
import { cdp } from "./session.js";

let policy = null;

/** Arm the response used for subsequent dialogs. */
export function setDialogPolicy(next) {
  policy = next;
  return policy;
}

/** Answer dialogs while a policy is armed. Called once at startup. */
export function installDialogListener() {
  chrome.debugger.onEvent.addListener(async (src, method) => {
    if (method !== "Page.javascriptDialogOpening" || !policy || src.tabId == null) return;
    try {
      await cdp(src.tabId, "Page.handleJavaScriptDialog", { accept: policy.accept, promptText: policy.promptText });
    } catch {}
  });
}

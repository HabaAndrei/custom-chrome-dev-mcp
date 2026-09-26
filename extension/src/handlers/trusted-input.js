// Mirrors src/tools/trusted-input.js on the server.
//
// Everything here dispatches through CDP so the page sees isTrusted=true events -
// the same path a physical mouse and keyboard take. Each handler attaches the
// debugger first, which is what puts the "being debugged" banner on the tab.
import { resolveTab, toTarget } from "../tabs.js";
import { runWalker } from "../walker-bridge.js";
import { cdp, centerOf, detachFrom, ensureAttached, getPointer, setPointer } from "../cdp/session.js";
import { pressCombo, typeText } from "../cdp/keyboard.js";
import { setDialogPolicy } from "../cdp/dialogs.js";

const META = { requireScriptable: false };

/** Attach and resolve in one step - every trusted-input handler starts this way. */
async function cdpTab(a, opts) {
  const tab = await resolveTab(a, opts);
  await ensureAttached(tab.id);
  return tab;
}

/** `MouseEvent.buttons` bitmask - which buttons are held DURING an event. */
const BUTTON_MASK = { left: 1, right: 2, middle: 4 };

/**
 * Glide the pointer to a point instead of teleporting to it.
 *
 * A real cursor passes through the space between two points, firing mousemove the
 * whole way. Menus that open on mouseover, hover-intent handlers that measure
 * movement, and drag implementations that need more than one move all depend on
 * those intermediate events - and a single instant jump is a tell on its own.
 * Step count scales with distance, so a short hop stays cheap.
 */
async function moveMouseTo(tabId, to, buttons = 0) {
  // With no history, approach from just above rather than inventing a wild origin.
  const from = getPointer(tabId) || { x: to.x, y: Math.max(0, to.y - 120) };
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.min(12, Math.round(distance / 40)));

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Ease-out: a hand decelerates into its target instead of moving at constant speed.
    const eased = 1 - Math.pow(1 - t, 3);
    await cdp(tabId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: Math.round(from.x + (to.x - from.x) * eased),
      y: Math.round(from.y + (to.y - from.y) * eased),
      buttons,
    });
  }
  setPointer(tabId, to);
}

/**
 * A real press-and-release at a point, used to focus before typing.
 *
 * `buttons` is the detail that is easy to miss: it must read as held during the press
 * and clear on release. Omitting it leaves every event claiming no button was down,
 * which contradicts the mousedown that is being delivered.
 */
async function clickAt(tabId, { x, y }, button = "left", clickCount = 1) {
  const mask = BUTTON_MASK[button] || 1;
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount, buttons: mask });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount, buttons: 0 });
}

/** Focus a target by clicking it, if the caller gave one. */
async function focusTarget(tabId, a) {
  if (!toTarget(a)) return;
  const point = await centerOf(tabId, a);
  await moveMouseTo(tabId, point);
  await clickAt(tabId, point);
}

export const trustedInputHandlers = {
  async realClick(a) {
    const tab = await cdpTab(a);
    const point = await centerOf(tab.id, a);
    const button = a.button || "left";
    const clickCount = a.clickCount || 1;

    await moveMouseTo(tab.id, point);
    await clickAt(tab.id, point, button, clickCount);
    return { clicked: [point.x, point.y], button };
  },

  async hover(a) {
    const tab = await cdpTab(a);
    const point = await centerOf(tab.id, a);
    await moveMouseTo(tab.id, point);
    return { hovered: [point.x, point.y] };
  },

  async press(a) {
    const tab = await cdpTab(a);
    await focusTarget(tab.id, a);
    for (const key of Array.isArray(a.keys) ? a.keys : [a.keys]) await pressCombo(tab.id, key);
    return { pressed: a.keys };
  },

  async realType(a) {
    const tab = await cdpTab(a);
    await focusTarget(tab.id, a);
    // Real keystrokes rather than Input.insertText - see typeText for why that
    // matters. `delay: 0` is available when a caller wants raw speed instead.
    const typed = await typeText(tab.id, a.text, a.delay == null ? 18 : a.delay);
    return { typed };
  },

  async drag(a) {
    const tab = await cdpTab(a);
    const from = a.from || {};
    const to = a.to || {};
    const bothAreElements = (from.x == null || from.y == null) && (to.x == null || to.y == null);

    let start, end;
    if (bothAreElements) {
      // Resolve BOTH element centres in one scroll frame (see the walker's dragPoints)
      // so scrolling to reach the destination can't invalidate the source coordinate.
      const pts = await runWalker(tab.id, "dragPoints", { from: toTarget(from), to: toTarget(to) });
      start = pts.from;
      end = pts.to;
    } else {
      start = await centerOf(tab.id, from);
      end = await centerOf(tab.id, to);
    }

    await moveMouseTo(tab.id, start);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", clickCount: 1, buttons: 1 });
    // Interpolated, with the button reported as held the whole way. A single jump
    // move is what most drag targets reject - HTML5 drag and the common JS drag
    // libraries both need to observe motion between press and release.
    await moveMouseTo(tab.id, end, 1);
    await cdp(tab.id, "Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", clickCount: 1, buttons: 0 });
    return { dragged: true };
  },

  async uploadFile(a) {
    const tab = await cdpTab(a);
    const doc = await cdp(tab.id, "DOM.getDocument", { depth: 0 });
    const found = await cdp(tab.id, "DOM.querySelector", { nodeId: doc.root.nodeId, selector: a.selector });
    if (!found.nodeId) throw new Error("file input not found: " + a.selector);

    await cdp(tab.id, "DOM.setFileInputFiles", { files: a.paths, nodeId: found.nodeId });
    return { uploaded: a.paths };
  },

  async setViewport(a) {
    const tab = await cdpTab(a);
    await cdp(tab.id, "Emulation.setDeviceMetricsOverride", {
      width: a.width, height: a.height, deviceScaleFactor: a.deviceScaleFactor || 1, mobile: !!a.mobile,
    });
    if (a.userAgent) await cdp(tab.id, "Emulation.setUserAgentOverride", { userAgent: a.userAgent });
    return { viewport: [a.width, a.height] };
  },

  async setCPUThrottling(a) {
    const tab = await cdpTab(a);
    await cdp(tab.id, "Emulation.setCPUThrottlingRate", { rate: a.rate });
    return { rate: a.rate };
  },

  async setGeolocation(a = {}) {
    const tab = await cdpTab(a);
    if (a.clear) {
      await cdp(tab.id, "Emulation.clearGeolocationOverride");
      return { cleared: true };
    }
    const override = { latitude: a.latitude, longitude: a.longitude, accuracy: a.accuracy ?? 1 };
    await cdp(tab.id, "Emulation.setGeolocationOverride", override);
    return { applied: override };
  },

  async setMediaFeatures(a = {}) {
    const tab = await cdpTab(a);
    if (a.clear) {
      await cdp(tab.id, "Emulation.setEmulatedMedia", { media: "", features: [] });
      return { cleared: true };
    }
    const features = [];
    if (a.colorScheme) features.push({ name: "prefers-color-scheme", value: a.colorScheme });
    if (a.reducedMotion) features.push({ name: "prefers-reduced-motion", value: a.reducedMotion });
    await cdp(tab.id, "Emulation.setEmulatedMedia", { media: a.media || "", features });
    return { media: a.media || "", features };
  },

  async handleDialog(a) {
    const tab = await cdpTab(a, META);
    await cdp(tab.id, "Page.enable");
    return { dialogPolicy: setDialogPolicy({ accept: a.accept !== false, promptText: a.promptText }) };
  },

  async detach(a = {}) {
    const tab = await resolveTab(a, META);
    await detachFrom(tab.id);
    return { detached: true };
  },
};

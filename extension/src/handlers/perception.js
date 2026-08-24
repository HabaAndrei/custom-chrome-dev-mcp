// Mirrors src/tools/perception.js on the server. All of these are pure walker reads.
import { domOp } from "../walker-bridge.js";
import { toTarget } from "../tabs.js";

export const perceptionHandlers = {
  async snapshot(a = {}) { return domOp("getHtml", {}, a); },
  async snapshotA11y(a = {}) { return domOp("snapshot", {}, a); },
  async getText(a) { return domOp("getText", { target: toTarget(a) }, a); },
  async getAttribute(a) { return domOp("getAttribute", { target: toTarget(a), name: a.attr }, a); },
  async queryAll(a) { return domOp("queryAll", { selector: a.selector, limit: a.limit }, a); },
  async viewport(a = {}) { return domOp("viewport", {}, a); },
};

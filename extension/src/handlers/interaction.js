// Mirrors src/tools/interaction.js on the server. Synthetic DOM operations, all
// executed by the walker inside the page's ISOLATED world.
import { domOp } from "../walker-bridge.js";
import { toTarget } from "../tabs.js";

export const interactionHandlers = {
  async click(a) { return domOp("click", { target: toTarget(a) }, a); },
  async type(a) { return domOp("type", { target: toTarget(a), text: a.text }, a); },
  async fill(a) { return domOp("fill", { target: toTarget(a), text: a.text, verify: a.verify }, a); },
  async assert(a) { return domOp("assert", { target: toTarget(a), text: a.text, value: a.value }, a); },
  async scroll(a) { return domOp("scroll", { target: toTarget(a), direction: a.direction, amount: a.amount }, a); },
  async select(a) { return domOp("select", { target: toTarget(a), value: a.value, label: a.label }, a); },
  async check(a) { return domOp("check", { target: toTarget(a), checked: a.checked }, a); },
  async submit(a) { return domOp("submit", { target: toTarget(a) }, a); },

  // Accepts a text string too - poll until it appears anywhere on the page.
  async waitForSelector(a) {
    return domOp("waitFor", { target: a.text != null ? a.text : toTarget(a), timeoutMs: a.timeout }, a);
  },
};

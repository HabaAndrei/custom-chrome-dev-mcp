// Translating key names into the CDP key events a real keyboard would produce.
import { cdp } from "./session.js";

/** CDP modifier bitmask. */
const MODIFIER = { Control: 2, Ctrl: 2, Alt: 1, Meta: 4, Cmd: 4, Command: 4, Shift: 8 };

/** Named keys that need an explicit code + virtual key code. */
const NAMED_KEYS = {
  Enter: { key: "Enter", code: "Enter", kc: 13 },
  Tab: { key: "Tab", code: "Tab", kc: 9 },
  Escape: { key: "Escape", code: "Escape", kc: 27 },
  Esc: { key: "Escape", code: "Escape", kc: 27 },
  Backspace: { key: "Backspace", code: "Backspace", kc: 8 },
  Delete: { key: "Delete", code: "Delete", kc: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", kc: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", kc: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", kc: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", kc: 39 },
  Home: { key: "Home", code: "Home", kc: 36 },
  End: { key: "End", code: "End", kc: 35 },
  PageUp: { key: "PageUp", code: "PageUp", kc: 33 },
  PageDown: { key: "PageDown", code: "PageDown", kc: 34 },
  Space: { key: " ", code: "Space", kc: 32 },
};

/**
 * Press one combo, e.g. "Enter", "Meta+c", "a".
 * A bare printable character also gets a `char` event so the page receives the text.
 */
export async function pressCombo(tabId, combo) {
  const parts = String(combo).split("+");
  const keyName = parts.pop();

  let modifiers = 0;
  for (const m of parts) modifiers |= MODIFIER[m] || 0;

  const spec = NAMED_KEYS[keyName] ||
    (keyName.length === 1
      ? { key: keyName, code: "Key" + keyName.toUpperCase(), kc: keyName.toUpperCase().charCodeAt(0) }
      : null);
  if (!spec) throw new Error("unknown key: " + keyName);

  const base = { modifiers, key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.kc, nativeVirtualKeyCode: spec.kc };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  if (spec.key.length === 1 && modifiers === 0)
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "char", text: spec.key, key: spec.key, code: spec.code });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

/** Characters that a US keyboard produces only with Shift held. */
const SHIFTED = new Set('~!@#$%^&*()_+{}|:"<>?');

/** Best-effort physical `code` for a printable character. */
function codeForChar(ch) {
  if (/[a-zA-Z]/.test(ch)) return "Key" + ch.toUpperCase();
  if (/[0-9]/.test(ch)) return "Digit" + ch;
  if (ch === " ") return "Space";
  return "";
}

/**
 * Type text the way a keyboard does: a keyDown/keyUp pair per character, with the
 * character carried on `text` so the page also gets keypress + input.
 *
 * The alternative, Input.insertText, drops the entire string in at once and emits no
 * key events whatsoever - so search-as-you-type boxes, character counters, and
 * per-keystroke validation never run, and the instant appearance of a fully-formed
 * value is itself one of the clearest automation tells there is.
 *
 * @param delay ms between characters; a small jitter keeps the rhythm off a metronome.
 */
export async function typeText(tabId, text, delay = 18) {
  const chars = [...String(text)];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\n" || ch === "\r") { await pressCombo(tabId, "Enter"); continue; }

    const code = codeForChar(ch);
    const kc = ch.toUpperCase().charCodeAt(0);
    const modifiers = (SHIFTED.has(ch) || /[A-Z]/.test(ch)) ? 8 : 0;
    const base = { key: ch, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, modifiers };

    // type:"keyDown" WITH text is what makes Chrome generate the character; the
    // rawKeyDown used by pressCombo deliberately does not.
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", text: ch, unmodifiedText: ch, ...base });
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });

    if (delay > 0 && i < chars.length - 1) {
      const jitter = delay * (0.6 + Math.random() * 0.8);
      await new Promise((r) => setTimeout(r, jitter));
    }
  }
  return chars.length;
}

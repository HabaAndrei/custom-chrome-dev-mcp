// Assertion vocabulary. Every failure message names what was expected, what arrived,
// and enough context to fix it without re-reading the test.

export class AssertionError extends Error {
  constructor(message) { super(message); this.name = "AssertionError"; }
}

const show = (v) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? String(v) : s.length > 200 ? s.slice(0, 200) + "…" : s;
};

export const fail = (message) => { throw new AssertionError(message); };

/** Strict-ish equality after string coercion - page values arrive as strings. */
export function equals(actual, expected, what = "value") {
  if (String(actual) !== String(expected))
    fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
}

export function contains(haystack, needle, what = "value") {
  const text = typeof haystack === "string" ? haystack : JSON.stringify(haystack);
  if (!text || !text.includes(needle))
    fail(`${what}: expected to contain ${show(needle)}, got ${show(text)}`);
}

export function isTrue(actual, what = "condition") {
  if (actual !== true && String(actual) !== "true") fail(`${what}: expected true, got ${show(actual)}`);
}

export function isFalse(actual, what = "condition") {
  if (actual !== false && String(actual) !== "false") fail(`${what}: expected false, got ${show(actual)}`);
}

export function isAtLeast(actual, min, what = "value") {
  if (!(Number(actual) >= min)) fail(`${what}: expected >= ${min}, got ${show(actual)}`);
}

export function isArray(actual, what = "value") {
  if (!Array.isArray(actual)) fail(`${what}: expected an array, got ${show(actual)}`);
}

export function hasKey(obj, key, what = "object") {
  if (!obj || typeof obj !== "object" || obj[key] === undefined)
    fail(`${what}: expected key ${show(key)}, got ${show(obj)}`);
}

/**
 * Assert a call rejects, optionally matching the message.
 * @returns {Promise<string>} the error message, for further inspection
 */
export async function rejects(fn, pattern, what = "call") {
  let message;
  try {
    await fn();
  } catch (err) {
    message = err?.message ?? String(err);
    if (pattern && !new RegExp(pattern, "i").test(message))
      fail(`${what}: rejected with the wrong error - wanted /${pattern}/i, got ${show(message)}`);
    return message;
  }
  fail(`${what}: expected a rejection${pattern ? ` matching /${pattern}/i` : ""}, but it resolved`);
}

/** File-format sniffers, so a "screenshot" that is really an error page fails loudly. */
export function isPng(buf, what = "image") {
  if (!(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47))
    fail(`${what}: not a PNG (magic ${[...buf.slice(0, 4)].map((b) => b.toString(16)).join(" ")})`);
  isAtLeast(buf.length, 1000, `${what} size`);
}

export function isWebm(buf, what = "video") {
  if (!(buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3))
    fail(`${what}: not a WebM (magic ${[...buf.slice(0, 4)].map((b) => b.toString(16)).join(" ")})`);
  isAtLeast(buf.length, 2000, `${what} size`);
}

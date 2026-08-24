// Write allowlist for capture files.
//
// Tools accept a caller-supplied `path`, so this is the security boundary that keeps a
// screenshot or recording from landing anywhere on disk. Two checks, because either
// alone is bypassable: a lexical one (rejects ../ traversal) and a realpath one
// (rejects a symlinked subdirectory pointing outside the capture root).
import fs from "node:fs";
import path from "node:path";
import { CAPTURE_DIR, SERVER_NAME } from "../config.js";

// The capture root must exist before realpathSync() can resolve it.
fs.mkdirSync(CAPTURE_DIR, { recursive: true });

const escapes = (rel) => rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel);

/**
 * Resolve `requested` to an absolute path inside `captureDir`, creating the parent
 * directory. Throws if the result would escape the root.
 *
 * Takes the root as a parameter so the test suite can exercise this exact function
 * against a temp directory rather than re-implementing it.
 *
 * @param {string} captureDir allowed write root
 * @param {string|undefined} requested filename or relative path inside the root
 * @param {string} defaultExt extension used when no path is supplied (".png", ".webm", …)
 * @returns {string} absolute, verified-safe path
 */
export function resolveCapturePathIn(captureDir, requested, defaultExt) {
  const name = typeof requested === "string" && requested
    ? requested
    : `${SERVER_NAME}-capture-${Date.now()}${defaultExt}`;

  const abs = path.isAbsolute(name) ? path.resolve(name) : path.resolve(captureDir, name);
  if (escapes(path.relative(captureDir, abs)))
    throw new Error(`refusing to write outside capture dir: ${abs} (allowed base: ${captureDir})`);

  fs.mkdirSync(path.dirname(abs), { recursive: true });

  if (escapes(path.relative(fs.realpathSync(captureDir), fs.realpathSync(path.dirname(abs)))))
    throw new Error(`refusing to write outside capture dir (symlink escape): ${abs}`);

  return abs;
}

/** Resolve against the configured capture root. */
export const resolveCapturePath = (requested, defaultExt) =>
  resolveCapturePathIn(CAPTURE_DIR, requested, defaultExt);

/** Write base64 bytes to a verified capture path and describe the result. */
export function writeCapture(requested, defaultExt, base64) {
  const abs = resolveCapturePath(requested, defaultExt);
  const bytes = Buffer.from(base64, "base64");
  fs.writeFileSync(abs, bytes);
  return { saved: abs, bytes: bytes.length };
}

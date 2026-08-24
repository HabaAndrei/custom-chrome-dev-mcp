// Security invariants, checked without a browser.
//
// These guard the properties the README promises: writes confined to the capture
// directory, a token handshake, a minimal permission set, and an inert toolbar icon.
// They are the reason the offline lane exists — a regression here should fail CI, not
// wait for someone to reload an extension by hand.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineSuite } from "../lib/runner.js";
import { contains, equals, fail, isTrue, rejects } from "../lib/assert.js";
import { BANLIST } from "../../extension/src/config.js";
import { resolveCapturePathIn } from "../../src/capture/capture-path.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** Concatenate every .js file under a directory, for source-level assertions. */
function readTree(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return readTree(full);
      return entry.name.endsWith(".js") ? fs.readFileSync(full, "utf8") : "";
    })
    .join("\n");
}

export default defineSuite({
  name: "security",
  lane: "offline",

  setup() {
    // A sandbox capture root with a symlink pointing outside it, so the escape tests
    // exercise a real symlink rather than a hypothetical one.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cdm-capture-"));
    const inside = path.join(root, "base");
    const outside = path.join(root, "outside");
    fs.mkdirSync(inside, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    try { fs.symlinkSync(outside, path.join(inside, "escape")); } catch {}
    return { captureRoot: inside, outsideRoot: outside };
  },

  tests: {
    "accepts a path inside the capture root": ({ captureRoot }) => {
      const resolved = resolveCapturePathIn(captureRoot, "sub/shot.png", ".png");
      if (!resolved.startsWith(fs.realpathSync(captureRoot)) && !resolved.startsWith(captureRoot))
        fail(`resolved outside the root: ${resolved}`);
      return "nested path ok";
    },

    "invents a filename when none is given": ({ captureRoot }) => {
      const resolved = resolveCapturePathIn(captureRoot, undefined, ".webm");
      contains(resolved, ".webm", "default filename");
      contains(resolved, "custom-chrome-dev-mcp", "default filename");
      return path.basename(resolved);
    },

    "rejects .. traversal": async ({ captureRoot }) => {
      await rejects(() => resolveCapturePathIn(captureRoot, "../escaped.png", ".png"), "outside capture dir", "traversal");
      return "blocked";
    },

    "rejects a deep .. traversal": async ({ captureRoot }) => {
      await rejects(() => resolveCapturePathIn(captureRoot, "a/b/../../../escaped.png", ".png"), "outside capture dir", "deep traversal");
      return "blocked";
    },

    "rejects an absolute path elsewhere": async ({ captureRoot, outsideRoot }) => {
      await rejects(() => resolveCapturePathIn(captureRoot, path.join(outsideRoot, "x.png"), ".png"), "outside capture dir", "absolute path");
      return "blocked";
    },

    "rejects a symlinked escape": async ({ captureRoot }) => {
      await rejects(() => resolveCapturePathIn(captureRoot, "escape/x.png", ".png"), "symlink escape", "symlink");
      return "blocked";
    },

    "auth token matches on both sides": () => {
      const grab = (rel) => (read(rel).match(/AUTH_TOKEN = "([^"]+)"/) || [])[1];
      const server = grab("src/config.js");
      const extension = grab("extension/src/config.js");
      if (!server) fail("no AUTH_TOKEN in src/config.js");
      equals(extension, server, "extension AUTH_TOKEN");
      return "match";
    },

    "hub binds loopback only": () => {
      const hub = read("src/hub.js");
      contains(hub, '"127.0.0.1"', "hub bind host");
      if (/host:\s*"0\.0\.0\.0"/.test(hub)) fail("hub binds 0.0.0.0 — reachable from the LAN");
      return "127.0.0.1";
    },

    "extension requests no over-broad permissions": () => {
      const manifest = JSON.parse(read("extension/manifest.json"));
      const forbidden = ["tabCapture", "desktopCapture", "downloads", "nativeMessaging", "management", "cookies"];
      const found = forbidden.filter((p) => manifest.permissions.includes(p));
      if (found.length) fail(`unexpected permissions: ${found.join(", ")}`);
      return manifest.permissions.join(",");
    },

    "toolbar icon is inert": () => {
      const source = readTree(path.join(REPO, "extension/src"));
      if (/chrome\.action\.onClicked\.addListener/.test(source)) fail("an onClicked handler exists — a click could trigger behaviour");
      const manifest = JSON.parse(read("extension/manifest.json"));
      if (manifest.action?.default_popup) fail("the action declares a popup");
      return "no click handler, no popup";
    },

    // Tests what the patterns DO, not how they are spelled — a source-text check
    // passes even when a pattern is subtly broken.
    "ban list blocks the hosts it claims to": () => {
      const blocked = (url) => BANLIST.some((re) => re.test(url));
      for (const url of [
        "https://paypal.com/checkout",
        "https://www.paypal.com/",
        "https://mail.google.com/mail/u/0",
        "http://your-bank.com/login",
      ]) {
        isTrue(blocked(url), `BANLIST should block ${url}`);
      }
      return `${BANLIST.length} patterns`;
    },

    "ban list does not block ordinary sites": () => {
      const blocked = (url) => BANLIST.some((re) => re.test(url));
      for (const url of [
        "https://example.com/",
        "https://github.com/paypal/some-repo",
        "http://127.0.0.1:9878/",
      ]) {
        if (blocked(url)) fail(`BANLIST wrongly blocks ${url} — too broad`);
      }
      return "no false positives";
    },

    "no private key is committed": () => {
      const keys = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (/\.(pem|key|p12|pfx)$/i.test(entry.name)) keys.push(path.relative(REPO, full));
        }
      };
      walk(REPO);
      if (keys.length) fail(`key material in the repo: ${keys.join(", ")}`);
      return "none";
    },
  },
});

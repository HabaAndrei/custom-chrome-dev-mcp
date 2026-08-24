// The server ↔ extension contract, verified without a browser.
//
// Catches the failure mode the mirrored architecture invites: a tool registered on one
// side and forgotten on the other. Runs a real MCP handshake in-process, so it asserts
// on the published surface rather than on what the source happens to look like.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineSuite } from "../lib/runner.js";
import { equals, fail, isAtLeast } from "../lib/assert.js";
import { describeToolSurface } from "../lib/mcp-probe.js";
import { HANDLER_GROUPS, handlerNames } from "../../extension/src/handlers/index.js";
import { TOOL_GROUP_NAMES } from "../../src/tools/index.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Every tool name the browser suites (and their helpers) pass to call(). */
function toolsExercisedByTests() {
  const sources = [
    ...fs.readdirSync(TEST_DIR).filter((f) => f.endsWith(".suite.js")).map((f) => path.join(TEST_DIR, f)),
    path.join(TEST_DIR, "..", "lib", "page.js"),
  ];
  const exercised = new Set();
  for (const file of sources) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/\bcall\(\s*"([a-zA-Z0-9]+)"/g)) exercised.add(m[1]);
  }
  return exercised;
}

export default defineSuite({
  name: "contract",
  lane: "offline",

  tests: {
    "server completes an MCP handshake and lists tools": async () => {
      const { names } = await describeToolSurface();
      isAtLeast(names.length, 40, "registered tool count");
      return `${names.length} tools`;
    },

    "every published tool has an extension handler": async () => {
      const { names } = await describeToolSurface();
      const missing = names.filter((n) => !handlerNames.includes(n));
      if (missing.length) fail(`no handler in extension/src/handlers for: ${missing.join(", ")}`);
      return `${names.length} matched`;
    },

    "every extension handler is a published tool": async () => {
      const { names } = await describeToolSurface();
      const orphans = handlerNames.filter((h) => !names.includes(h));
      if (orphans.length) fail(`handler with no tool in src/tools: ${orphans.join(", ")}`);
      return `${handlerNames.length} matched`;
    },

    "no handler name is claimed by two groups": () => {
      // Groups merge by spread, so a duplicate silently loses to the last one.
      const owner = new Map();
      for (const [group, handlers] of Object.entries(HANDLER_GROUPS)) {
        for (const name of Object.keys(handlers)) {
          if (owner.has(name)) fail(`"${name}" is defined in both ${owner.get(name)} and ${group}`);
          owner.set(name, group);
        }
      }
      equals(owner.size, handlerNames.length, "unique handler names");
      return `${owner.size} unique`;
    },

    "tool groups and handler groups line up": () => {
      const handlers = Object.keys(HANDLER_GROUPS).sort();
      const tools = [...TOOL_GROUP_NAMES].sort();
      const onlyTools = tools.filter((g) => !handlers.includes(g));
      const onlyHandlers = handlers.filter((g) => !tools.includes(g));
      if (onlyTools.length || onlyHandlers.length)
        fail(`group mismatch - only in src/tools: [${onlyTools}], only in handlers: [${onlyHandlers}]`);
      return `${tools.length} groups`;
    },

    "every tool documents itself": async () => {
      const { tools } = await describeToolSurface();
      const bare = tools.filter((t) => !t.description || t.description.length < 30);
      if (bare.length) fail(`missing or too-thin descriptions: ${bare.map((t) => t.name).join(", ")}`);
      return "all described";
    },

    "every tool accepts the universal tab scope": async () => {
      const { tools } = await describeToolSurface();
      // Capture tools deliberately take only tabId - a capture has no frame or URL guard.
      const captureOnly = new Set(["screenshot", "fullPageScreenshot", "record"]);
      const offenders = tools
        .filter((t) => !captureOnly.has(t.name))
        .filter((t) => {
          const props = t.inputSchema?.properties ?? {};
          return !props.tabId || !props.frameId || !props.expectUrl;
        });
      if (offenders.length) fail(`missing tabId/frameId/expectUrl: ${offenders.map((t) => t.name).join(", ")}`);
      return `${tools.length - captureOnly.size} scoped`;
    },

    // The gate that keeps coverage honest: a tool added without a test fails CI,
    // without anyone needing to open Chrome.
    "every tool is exercised by at least one test": async () => {
      const { names } = await describeToolSurface();
      const exercised = toolsExercisedByTests();
      const untested = names.filter((n) => !exercised.has(n));
      if (untested.length) fail(`no test calls: ${untested.join(", ")}`);
      return `${names.length} covered`;
    },

    "capture tools expose a path argument": async () => {
      const { byName } = await describeToolSurface();
      for (const name of ["screenshot", "fullPageScreenshot", "record"]) {
        const props = byName.get(name)?.inputSchema?.properties ?? {};
        if (!props.path) fail(`${name} has no "path" argument`);
        if (!props.tabId) fail(`${name} has no "tabId" argument`);
      }
      return "3 checked";
    },
  },
});

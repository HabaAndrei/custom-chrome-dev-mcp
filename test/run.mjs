#!/usr/bin/env node
// Test entry point.
//
//   node test/run.mjs                  both lanes (offline, then browser)
//   node test/run.mjs --lane=offline   no browser needed — this is the CI gate
//   node test/run.mjs --lane=browser   drive real Chrome via the extension
//   node test/run.mjs --grep=fill      only tests whose suite/name matches
//   node test/run.mjs --list           show what would run
//
// The browser lane binds 127.0.0.1:9876, the port the real hub owns — so stop the MCP
// server first (`pkill -f src/hub.js`), then reload the extension when prompted.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { report, runSuites } from "./lib/runner.js";
import { handlerNames } from "../extension/src/handlers/index.js";
import { startFixtureServer } from "./lib/fixture-server.js";
import { connectExtension } from "./lib/bridge.js";
import { openSession } from "./lib/page.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A per-run directory for screenshots, recordings, and the upload sample. */
function prepareArtifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdm-artifacts-"));
  const uploadPath = path.join(dir, "upload-sample.txt");
  fs.writeFileSync(uploadPath, "hello custom-chrome-dev-mcp");
  return { artifacts: dir, uploadPath };
}

function parseArgs(argv) {
  const get = (flag) => argv.find((a) => a.startsWith(`--${flag}=`))?.split("=").slice(1).join("=");
  const lane = get("lane");
  return {
    lanes: lane ? lane.split(",") : ["offline", "browser"],
    grep: get("grep") ? new RegExp(get("grep"), "i") : undefined,
    list: argv.includes("--list"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

/** Load every *.suite.js in test/suites, in filename order. */
async function loadSuites() {
  const dir = path.join(HERE, "suites");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".suite.js")).sort();
  const suites = [];
  for (const file of files) suites.push((await import(pathToFileURL(path.join(dir, file)).href)).default);
  return suites;
}

/**
 * Report which tools the browser lane never touched.
 * A tool with no test is a tool nobody is checking — say so out loud.
 */
function reportCoverage(invoked, log) {
  const untested = handlerNames.filter((name) => !invoked.has(name)).sort();
  const covered = handlerNames.length - untested.length;
  const pct = Math.round((covered / handlerNames.length) * 100);

  log(`\n  tool coverage: ${covered}/${handlerNames.length} (${pct}%)`);
  if (untested.length) log(`    never exercised: ${untested.join(", ")}`);
  return untested;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
    return 0;
  }

  const suites = await loadSuites();

  if (args.list) {
    for (const suite of suites) {
      console.log(`\n${suite.name}  [${suite.lane}]`);
      for (const name of Object.keys(suite.tests)) console.log(`  · ${name}`);
    }
    return 0;
  }

  const wantsBrowser = args.lanes.includes("browser") && suites.some((s) => s.lane === "browser");
  const context = {};
  const teardown = [];

  if (wantsBrowser) {
    const fixtures = await startFixtureServer();
    teardown.push(fixtures.close);

    console.log(`\n  fixture server  ${fixtures.url}`);
    console.log("  waiting for the extension — open chrome://extensions and click reload ↻ …");

    const extension = await connectExtension();
    teardown.push(extension.close);
    console.log(`  extension connected (build ${extension.build})`);

    const session = await openSession(extension.call, fixtures.url);
    teardown.push(session.closeSession);

    Object.assign(context, {
      call: extension.call,
      invoked: extension.invoked,
      ...prepareArtifacts(),
      ...session,
    });
    console.log(`  fixture tab     ${session.tab}`);
    console.log(`  artifacts       ${context.artifacts}`);
  }

  console.log(`\n  custom-chrome-dev-mcp — ${args.lanes.join(" + ")} lane${args.lanes.length > 1 ? "s" : ""}`);
  const results = await runSuites(suites, { lanes: args.lanes, grep: args.grep, context });

  let coverageGap = [];
  if (wantsBrowser && !args.grep) coverageGap = reportCoverage(context.invoked, console.log);

  const ok = report(results);
  for (const close of teardown.reverse()) await close();

  // An untested tool is a failure of the suite, not a warning — but only when the full
  // browser lane ran, since --grep deliberately narrows what is exercised.
  return ok && !coverageGap.length ? 0 : 1;
}

process.exit(await main());

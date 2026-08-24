// Suite registry and execution.
//
// Two lanes, and the split is the point:
//   "offline" — pure Node. Static analysis and unit checks. Runs in CI, takes ms.
//   "browser" — needs Chrome with the extension loaded and a live fixture page.
// The old suite buried its offline checks behind "reload the extension in Chrome",
// so none of them could run unattended. Now `--lane=offline` is a real CI gate.
import { AssertionError } from "./assert.js";

const DEFAULT_TEST_TIMEOUT = 30000;

/**
 * Declare a suite.
 *
 * @param {{name: string, lane: "offline"|"browser", timeout?: number,
 *          setup?: (ctx) => Promise<any>, tests: Record<string, Function>}} spec
 */
export function defineSuite(spec) {
  if (!spec.name) throw new Error("suite needs a name");
  if (!["offline", "browser"].includes(spec.lane)) throw new Error(`suite ${spec.name}: lane must be "offline" or "browser"`);
  if (!spec.tests || !Object.keys(spec.tests).length) throw new Error(`suite ${spec.name}: no tests`);
  return spec;
}

const ICON = { pass: "✓", fail: "✗", skip: "–" };
const ms = (n) => (n < 1000 ? `${n}ms` : `${(n / 1000).toFixed(1)}s`);
/** Keep the note column narrow so timings stay in line. */
const note = (v) => { const s = String(v ?? ""); return s.length > 24 ? s.slice(0, 23) + "…" : s; };

/** Run one test with a hard timeout so a hung tool can't stall the whole run. */
async function runWithTimeout(fn, ctx, timeout) {
  let timer;
  try {
    return await Promise.race([
      fn(ctx),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`test exceeded ${timeout}ms`)), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute the selected suites.
 *
 * @param {object[]} suites from defineSuite
 * @param {{lanes: string[], grep?: RegExp, context: object, log?: Function}} opts
 * @returns {Promise<{passed: number, failed: number, skipped: number, failures: object[]}>}
 */
export async function runSuites(suites, { lanes, grep, context, log = console.log }) {
  const results = { passed: 0, failed: 0, skipped: 0, failures: [] };

  for (const suite of suites) {
    const selected = Object.entries(suite.tests).filter(([name]) => !grep || grep.test(`${suite.name} ${name}`));
    if (!lanes.includes(suite.lane) || !selected.length) {
      results.skipped += Object.keys(suite.tests).length;
      continue;
    }

    log(`\n  ${suite.name}`);
    const suiteContext = { ...context, ...(suite.setup ? await suite.setup(context) : {}) };

    for (const [name, fn] of selected) {
      const startedAt = Date.now();
      try {
        // Each browser test starts from a known page state — no inherited mutations.
        if (suite.lane === "browser" && suiteContext.resetPage) await suiteContext.resetPage();

        const outcome = await runWithTimeout(fn, suiteContext, suite.timeout ?? DEFAULT_TEST_TIMEOUT);
        results.passed++;
        log(`    ${ICON.pass} ${name.padEnd(46)} ${note(outcome).padEnd(25)} ${ms(Date.now() - startedAt)}`);
      } catch (err) {
        results.failed++;
        results.failures.push({ suite: suite.name, test: name, error: err });
        const kind = err instanceof AssertionError ? "" : `${err.name}: `;
        log(`    ${ICON.fail} ${name.padEnd(46)} ${kind}${err.message}`);
      }
    }
  }

  return results;
}

/** Print the failure detail block and the summary line. */
export function report(results, { log = console.log } = {}) {
  if (results.failures.length) {
    log("\n  failures");
    for (const f of results.failures) log(`    ${f.suite} › ${f.test}\n      ${f.error.message}`);
  }

  const parts = [`${results.passed} passed`];
  if (results.failed) parts.push(`${results.failed} failed`);
  if (results.skipped) parts.push(`${results.skipped} skipped`);
  log(`\n  ${results.failed ? ICON.fail : ICON.pass} ${parts.join(", ")}\n`);
  return results.failed === 0;
}

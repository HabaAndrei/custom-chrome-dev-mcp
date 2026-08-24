// Polling helpers that replace fixed sleeps.
//
// The old suite was littered with `await sleep(500)` - slow when the page was ready in
// 20ms, and flaky when it needed 600. These poll for the condition instead: they
// return as soon as it holds and fail with a real message when it never does.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `probe` until it returns a truthy value.
 *
 * @param {() => Promise<any>|any} probe
 * @param {{timeout?: number, interval?: number, what?: string}} opts
 * @returns {Promise<any>} the first truthy value
 */
export async function eventually(probe, { timeout = 5000, interval = 50, what = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let lastValue;
  let lastError;

  while (Date.now() < deadline) {
    try {
      lastValue = await probe();
      if (lastValue) return lastValue;
    } catch (err) {
      lastError = err;
    }
    await sleep(interval);
  }

  const detail = lastError ? `last error: ${lastError.message}` : `last value: ${JSON.stringify(lastValue)}`;
  throw new Error(`timed out after ${timeout}ms waiting for ${what} (${detail})`);
}

/** Poll until `probe` equals `expected` (string-coerced), then return it. */
export function eventuallyEquals(probe, expected, opts = {}) {
  return eventually(
    async () => (String(await probe()) === String(expected) ? { value: expected } : false),
    { what: `value to become ${JSON.stringify(expected)}`, ...opts },
  );
}

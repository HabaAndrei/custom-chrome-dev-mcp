// The browser test session: one fixture tab, plus the helpers every browser suite uses.
//
// Tests get a page in a known state. `reset` re-navigates if a navigation test wandered
// off, then calls the fixture's own __reset() to clear inputs and output divs — so no
// test can inherit another's mutations. The old suite had no isolation at all, which is
// why its tests only passed in one specific order.
import { eventually } from "./wait.js";

/**
 * Open the fixture page in a new tab and build the suite context.
 *
 * @param {Function} call the bridge's tool-call function
 * @param {string} fixtureUrl base URL of the fixture server
 */
export async function openSession(call, fixtureUrl) {
  const { created: tab } = await call("newtab", { url: `${fixtureUrl}/` });
  await call("activateTab", { tabId: tab });
  await call("waitForLoad", { tabId: tab });

  /** Evaluate an expression in the page and return it as a string. */
  const js = async (expression) => String(await call("evaluate", { expression, tabId: tab }));

  /** Read an element's property, the most common assertion target. */
  const prop = (selector, name) => js(`document.querySelector(${JSON.stringify(selector)})?.${name}`);

  /** Wait until an element's property equals a value. */
  const propBecomes = (selector, name, expected) =>
    eventually(async () => (await prop(selector, name)) === String(expected) ? expected : false, {
      what: `${selector}.${name} to become ${JSON.stringify(expected)}`,
    });

  async function reset() {
    // A navigation test may have left the tab elsewhere; put it back first.
    const { url } = await call("getUrl", { tabId: tab });
    if (!url || !url.startsWith(fixtureUrl) || url.includes("?")) {
      await call("navigate", { url: `${fixtureUrl}/`, tabId: tab });
      await call("waitForLoad", { tabId: tab });
    }
    await js("window.__reset && window.__reset()");
  }

  async function close() {
    await call("closeTab", { tabId: tab }).catch(() => {});
  }

  return { tab, fixtureUrl, js, prop, propBecomes, resetPage: reset, closeSession: close };
}

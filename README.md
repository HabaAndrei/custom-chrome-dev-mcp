# Custom Chrome Dev MCP

A **local-only** MCP (Model Context Protocol) server that lets an MCP client - Claude
Code, or anything else that speaks MCP - drive **your real Chrome browser** the way a
person would. No telemetry, no third-party services, no cloud: everything runs on your
machine behind a shared token.

It exposes **56 tools** across navigation, tabs, perception, interaction, trusted
input, observability, capture, and storage.

---

## Where this came from

This project is **inspired by Chrome's official browser MCP** - the
[**Chrome DevTools MCP**](https://github.com/ChromeDevTools/chrome-devtools-mcp)
server published by the Chrome DevTools team, which first made the case that an AI
agent should drive a browser through the DevTools Protocol rather than through
scraped HTML.

**We are replicating and imitating that idea, not shipping it.** What we borrowed:

- **The premise** - expose the browser to an agent as a set of MCP tools.
- **Accessibility-first perception** - hand the model a compact a11y outline with
  stable element refs instead of a wall of raw HTML.
- **The Chrome DevTools Protocol as the input layer** - real, trusted events instead
  of synthetic ones a page can spot and ignore.

Where this project **deliberately diverges**:

| | Chrome DevTools MCP | Custom Chrome Dev MCP |
| --- | --- | --- |
| Browser | **By default** launches its own Chrome with a dedicated user-data-dir; can also attach to a running instance via `--browser-url` | **Only ever** drives the Chrome you already have open |
| Attachment | Connects to the browser over the DevTools Protocol endpoint | A **Chrome extension living inside the browser**, pointed at whatever tab you choose |
| Primary goal | Debugging, inspecting, and profiling a page | **Behaving like a human using that page** |

That last row is the whole point of this repo. Chrome DevTools MCP is a debugging
tool that happens to drive a browser; this is an imitation-of-a-person tool that
happens to be useful for debugging.

> ⚠️ Not affiliated with, endorsed by, or supported by Google or the Chrome team.
> This is an independent reimplementation built to learn from and imitate their
> design. Use the official server if you want the supported thing.

---

## It deliberately keeps the styling of a human

Most browser automation is trivially detectable: synthetic events with
`isTrusted=false`, focus that never really moves, text that appears in a field all at
once, a pristine automation profile with no history. Every one of those is a signal.

This project tries to remove those signals:

- **Your real profile.** Actions run in the Chrome you already use - your cookies,
  logins, extensions, and history. Nothing to fingerprint as "fresh automation".
- **Trusted input.** `realClick`, `realType`, `press`, `hover`, and `drag` dispatch
  through the DevTools Protocol, so the page receives events with `isTrusted=true` -
  the same flag a physical mouse and keyboard produce.
- **Genuine focus.** Clicking to focus a field really moves focus, in order, rather
  than assigning `.value` behind the page's back.
- **Real keystrokes.** `press` emits proper `rawKeyDown` / `char` / `keyUp` sequences
  with correct key codes and modifiers, not a single synthetic `input` event.
- **Read-back verification.** `fill` confirms the field actually holds the text, so
  the agent notices when a page silently rejected the input - as a person would.

The goal: a page should behave for the agent exactly as it behaves for someone sitting
at the keyboard.

Fast synthetic tools (`click`, `type`) are still there - they're quicker and work on
most sites. When a page ignores them, reach for the trusted equivalents.

---

## How it works

One transport. The MCP client talks to the server over stdio; the server relays to a
Chrome extension over a local WebSocket owned by a small long-lived **hub** process.

```
MCP client 1 (Claude) <-stdio-> bin/custom-chrome-dev-mcp.js ─┐
MCP client 2 (Claude) <-stdio-> bin/custom-chrome-dev-mcp.js ─┼─ src/hub.js (127.0.0.1:9876)
MCP client N (Claude) <-stdio-> bin/custom-chrome-dev-mcp.js ─┘              │
                                                                            │ WebSocket
                                                                            ▼
                                                              Chrome extension -> active tab
```

**Why a separate hub process.** Only one process can own port `9876`, but you may
have several Claude sessions open and all of them may want the browser. So the socket
lives in `src/hub.js` rather than inside any one session. Each session connects to the
hub as `role:"mcp"`, the extension connects as `role:"extension"`, and the hub
multiplexes between them. The first session to start spawns the hub **detached**, so
it outlives that session; later sessions find it already listening.

Inside the extension there are three layers:

1. **Walker** (`page/walker.js`) - injected into the page's ISOLATED world. Owns
   element resolution, the stable `eN` ref map, and the fast synthetic DOM ops.
2. **CDP** (`cdp/`) - `chrome.debugger` for trusted input, page-context `evaluate`,
   full-page screenshots, and the console/network buffers.
3. **Recording** (`recording/`) - CDP screencast frames encoded to `.webm` by a
   `MediaRecorder` in an offscreen document.

> 🔒 The extension authenticates to the hub with a shared token (`AUTH_TOKEN`,
> identical in `src/config.js` and `extension/src/config.js`). The hub drops any peer
> that presents a different value.

---

## Prerequisites

| | Requirement | Check |
| --- | --- | --- |
| **Node.js** | 18 or newer (developed on 22) | `node --version` |
| **Chrome** | Google Chrome or Chromium, any recent version | `chrome://version` |
| **An MCP client** | Claude Code, or anything else that speaks MCP over stdio | `claude --version` |

No global installs, no build step, no service to sign up for. Two runtime dependencies
(`@modelcontextprotocol/sdk` and `ws`) and everything stays on `127.0.0.1`.

---

## Local setup

Four steps, then a verification pass. Budget five minutes.

### 1. Clone and install

```sh
git clone <your-fork-url> custom-chrome-dev-mcp
cd custom-chrome-dev-mcp
npm install
```

Confirm the tree is healthy before wiring anything to Chrome - the offline lane needs
no browser and takes under a second:

```sh
npm test
```

You want `22 passed`. If that fails, fix it before continuing; nothing downstream will
work.

### 2. Load the extension into Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the **`extension/`** folder - the folder itself,
   not `manifest.json` inside it.
4. **Custom-chrome-dev-mcp** appears in the list.

> ⚠️ **Load it into the Chrome profile you actually browse in.** Chrome keeps
> extensions per profile, so an extension loaded into "Profile 4" is invisible to the
> window running under "Default". If tools later report no tabs, or the hub never logs
> `extension connected`, this is the first thing to check. `chrome://version` shows the
> active **Profile Path**.

The extension ID is pinned by the public `key` in `extension/manifest.json`, so it is
identical on every machine - nothing to copy between setups.

### 3. Register the MCP server with your client

**Use the CLI** - substitute the absolute path where you cloned the repo (`pwd` in the
project root prints it):

```sh
claude mcp add -s user custom-chrome-dev-mcp -- node /ABSOLUTE/PATH/TO/custom-chrome-dev-mcp/bin/custom-chrome-dev-mcp.js
```

- `-s user` registers it for **all** your projects; `-s local` limits it to this one.
- Register **`bin/custom-chrome-dev-mcp.js`** - that file is the entry point. Pointing
  at `src/server.js` will not work.
- The path must be **absolute**. A relative path resolves against whatever directory
  the client happened to launch from.
- Confirm with `claude mcp list` - you want a `✔ Connected` next to it.

> ⚠️ **Do not hand-edit `~/.claude.json`.** It is large, and one misplaced comma breaks
> Claude Code entirely. The command above edits it safely.

<details>
<summary>Alternative - manual JSON (only if you can't use the CLI)</summary>

Add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "custom-chrome-dev-mcp": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/custom-chrome-dev-mcp/bin/custom-chrome-dev-mcp.js"]
    }
  }
}
```

</details>

### 4. Restart the MCP client

MCP clients enumerate tools once, at startup - a server registered mid-session is
invisible until you restart. Restart Claude, and the 56 tools appear.

On restart the client launches the server, which spawns `src/hub.js` if nothing is
already listening on `127.0.0.1:9876`.

### 5. Verify all three links in the chain

The stack is *client → server → hub → extension → tab*. Check it end to end rather
than guessing which link is down.

```sh
# The hub is up, and the extension found it:
tail -f "$TMPDIR/custom-chrome-dev-mcp-hub.log"
#   [hub] listening on 127.0.0.1:9876
#   [hub] extension connected      <- this line is the handshake succeeding

# Who owns the port (should be src/hub.js from THIS repo):
lsof -nP -iTCP:9876 -sTCP:LISTEN
```

Then ask your client for **`listTabs`**. A JSON array of your open tabs means every
link works. Follow it with **`screenshot`** - a PNG lands in `~/Downloads` *and* comes
back inline.

For the extension's own console: `chrome://extensions` → **Custom-chrome-dev-mcp** →
**service worker** → **Inspect**. That is where extension-side errors surface; they
never reach the MCP client.

### 6. Change the shared token before real use

`AUTH_TOKEN` ships with a default value, defined identically in **`src/config.js`** and
**`extension/src/config.js`**. It is the only thing stopping another process on your
machine from driving your logged-in browser. Pick your own value, change it in **both**
files (an offline test asserts they match), and reload the extension.

---

## After you change code

The two halves reload differently, and getting this wrong wastes more time than
anything else in the project:

| You edited | To pick it up |
| --- | --- |
| Anything under **`extension/`** | Click **reload ↻** on the extension in `chrome://extensions`. Chrome keeps running the previously loaded build until you do. |
| Anything under **`src/`** | Restart the MCP client. The server process is long-lived and holds the old tool schemas. |
| **`src/hub.js`** | `pkill -f src/hub.js` - the next tool call respawns it. |

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `claude mcp list` shows `✘ Failed to connect` | Wrong path, or not the `bin/` entry point | Re-register with the absolute path to `bin/custom-chrome-dev-mcp.js` |
| Tools missing from the client entirely | Registered mid-session | Restart the MCP client |
| Hub log never says `extension connected` | Extension not loaded, loaded in a different Chrome profile, or `AUTH_TOKEN` differs between the two `config.js` files | Check `chrome://version` → Profile Path; confirm both tokens match |
| A tool call hangs, then times out | The service worker died, or an extension-side exception | Open the service worker console; click **reload ↻** |
| Port `9876` owned by an unexpected process | A hub from another clone of this project is squatting the port | `lsof -nP -iTCP:9876 -sTCP:LISTEN`, then kill that PID |
| An edit to `extension/` "did nothing" | Chrome is still running the old build | Click **reload ↻** |
| `URL is banlisted` | `BANLIST` in `extension/src/config.js` blocks that host | Edit the list - it ships with placeholder entries |
| `refusing to act: … does not contain expectUrl` | The `expectUrl` guard fired, correctly | Drop the guard, or point it at the real URL |
| Screenshot path rejected | Writes are confined to the capture directory | Use a filename or a path **inside** it |
| A tool targets the wrong tab | A background tab stole focus | Pin the working tab with `useTab` |

---

## Configuration

Both are optional environment variables read at startup by `src/config.js`.

| Variable | Default | What it does |
| --- | --- | --- |
| `CUSTOM_CHROME_DEV_MCP_CAPTURE_DIR` | `~/Downloads` | The **only** directory screenshots and recordings may be written to. |
| `CUSTOM_CHROME_DEV_MCP_WS_PORT` | `9876` | Hub port. Change it in `extension/src/config.js` too, or they won't find each other. |

Also worth changing for real use: **`AUTH_TOKEN`**, defined identically in
`src/config.js` and `extension/src/config.js`. Pick your own value - it is what stops
another local process from driving your browser.

---

## Available tools (56)

Elements are targeted three ways: **`selector`** (CSS), **`ref`** (a stable `eN` id
from `snapshotA11y`), or **`name`** (accessible name, e.g. a button's label). "target"
below means any one of those three.

**Universal params**, accepted by every tool:

- **`tabId`** - act on a specific tab instead of the ambient active one.
- **`frameId`** (from `listFrames`) - act inside a specific frame, including
  cross-origin iframes the top document cannot script.
- **`expectUrl`** - a guard: refuse the action unless the tab's URL contains this
  substring.

Pin a working tab for the whole session with **`useTab`** so a background tab (an
autoplaying video, a notification popup) can't steal focus and misdirect an action.

### Navigation

| Tool | Args | Description |
| --- | --- | --- |
| `navigate` | `url` | Point the tab at a URL (replaces the page). |
| `newtab` | `url` | Open a URL in a **new** foreground tab, leaving the current page intact. |
| `back` / `forward` | - | History back / forward. |
| `reload` | `hard?` | Reload, optionally bypassing the cache. |
| `getUrl` / `getTitle` | - | The tab's URL / title (works on internal pages too). |
| `waitForLoad` | `timeout?` | Block until the tab finishes loading. |

### Tabs & frames

| Tool | Args | Description |
| --- | --- | --- |
| `listTabs` | - | Every open tab across all windows (`id`, `title`, `url`, `active`, `pinned`). |
| `activateTab` | `tabId` | Focus a tab and its window. |
| `closeTab` | `tabId` | Close a tab by id. |
| `useTab` | `tabId?` | **Pin** the working tab so every later tool targets it regardless of OS focus. Omit `tabId` to pin the current one. |
| `unpinTab` | - | Release the pin; tools revert to the active tab. |
| `listFrames` | - | Every frame incl. cross-origin as `{frameId, parentFrameId, url, origin}`. |

### Perception

| Tool | Args | Description |
| --- | --- | --- |
| `snapshotA11y` | - | Compact accessibility outline of visible interactive elements as `role "name" ref=eN`. **Prefer this over `snapshot`.** Refs expire on navigation or re-snapshot. |
| `snapshot` | - | Raw `outerHTML` of `<body>`, truncated to 50k. Use when you need exact markup. |
| `getText` | target | `innerText` of one element, trimmed. |
| `getAttribute` | target, `attr` | An attribute, falling back to the live DOM property (`value`, `checked`, `href`). |
| `queryAll` | `selector`, `limit?` | text/href/value/visible for **every** match at once. |
| `viewport` | - | `devicePixelRatio`, CSS viewport, scroll offset - how you map screenshot px → CSS px. |
| `getComputedStyle` | target, `properties?` | Computed CSS - a curated default set (box model, typography, color), or just the properties you name. |

### Interaction - synthetic, fast

Untrusted events dispatched by the walker. Quick, and enough for most sites.

| Tool | Args | Description |
| --- | --- | --- |
| `click` | target | Bubbling `MouseEvent` click; also **focuses** the element; `.click()` fallback. Returns `{focused}`. |
| `type` | target, `text` | Set a field's value via the native setter (handles `<input>`, `<textarea>`, **and** contenteditable). Returns `{value}`. |
| `fill` | target, `text`, `verify?` | Focus + set + **read back**. Throws if the text didn't stick. **The reliable text-entry path** - prefer it over click-then-type. |
| `assert` | target, `text?`, `value?` | Verify text (substring) and/or exact value without a screenshot → `{ok, checks}`. |
| `scroll` | target?, `direction?`, `amount?` | Scroll an element into view, or the window (`top`/`bottom` jump to extremes). |
| `select` | target, `value?` / `label?` | Choose a `<select>` option by value or visible label. |
| `check` | target, `checked` | Set a checkbox/radio, clicking only if it isn't already there. |
| `submit` | target | `requestSubmit()` the owning form - for forms with no clickable button. |
| `waitForSelector` | target **or** `text`, `timeout?` | Poll until an element resolves **or** a text substring appears. |
| `setAttribute` | target, `name`, `value` | Set an HTML attribute directly - a live DOM edit, not just the markup it shipped with. |
| `removeAttribute` | target, `name` | Remove an HTML attribute. |

### Trusted input & emulation - CDP

Real events with `isTrusted=true`. These attach `chrome.debugger`, which shows a
persistent yellow *"being debugged"* banner on the tab.

| Tool | Args | Description |
| --- | --- | --- |
| `realClick` | target / `x,y`, `button?`, `clickCount?` | **Trusted** click, including right-click and double-click. |
| `realType` | target?, `text` | Trusted text insertion, focusing the target first if given. |
| `press` | `keys`, target? | Trusted keys and combos: `"Enter"`, `"Tab"`, `"Meta+c"`, `["ArrowDown","Enter"]`. |
| `hover` | target / `x,y` | Move the real mouse over an element to fire `:hover` (reveals menus and tooltips). |
| `drag` | `from`, `to` | Trusted press-move-release drag & drop. |
| `uploadFile` | `selector`, `paths[]` | Set files on an `<input type=file>`, bypassing the OS picker. Absolute paths. |
| `setViewport` | `width`, `height`, `deviceScaleFactor?`, `mobile?`, `userAgent?` | Emulate a viewport / device for responsive checks. |
| `handleDialog` | `accept?`, `promptText?` | **Pre-arm** an answer for the next `alert`/`confirm`/`prompt`. Set it *before* the action that triggers the dialog. |
| `detach` | - | Detach the debugger and clear the banner. Re-attaches on the next CDP call. |

### Observability - CDP, buffered per tab

Capture starts when the debugger attaches, so **reload the page after the first CDP
call** if you want load-time activity.

| Tool | Args | Description |
| --- | --- | --- |
| `getConsole` | `level?`, `limit?`, `clear?` | Buffered console logs, warnings, errors, and uncaught exceptions. |
| `listNetworkRequests` | `urlContains?`, `status?`, `failedOnly?`, `limit?` | Buffered requests: method, url, status, type, timing. |
| `getNetworkRequest` | `requestId`, `includeBody?` | One request in full; `includeBody` also fetches the (truncated) response body. |
| `evaluate` | `expression` | Run JS in the page's **real** context via CDP - bypasses the content-script CSP that blocks `eval`. Awaits promises. Not available on `chrome://` pages. |

### Capture

Saved into the capture directory (`~/Downloads` by default - see
[Configuration](#configuration)).

| Tool | Args | Description |
| --- | --- | --- |
| `screenshot` | `path?`, `format?`, `tabId?` | Visible viewport as PNG/JPEG - **saved to disk and returned inline** with `{devicePixelRatio, cssViewport}`, so the model sees it in one call. |
| `fullPageScreenshot` | `path?`, `tabId?` | The **entire scrollable page** beyond the viewport, via CDP. |
| `record` | `action`, `path?`, `tabId?` | `start` / `stop` / `status` tab recording → `.webm`. Fully MCP-driven - **no toolbar click or user gesture needed**. Records the **tab**, not the desktop. |

`path` is a filename or a path **inside** the capture directory. Missing subfolders
are created; anything resolving outside the directory is refused.

### Storage - cookies via CDP, localStorage/sessionStorage via `evaluate`

Cookies go through the CDP Network domain (sees httpOnly cookies a page's own JS
cannot); `local`/`session` storage tools run through the same `Runtime.evaluate` path
as `evaluate`, so they only see what the page itself could see. Both respect the ban
list, same as every other scriptable tool.

| Tool | Args | Description |
| --- | --- | --- |
| `getCookies` | - | Every cookie visible to the tab's current URL. |
| `setCookie` | `name`, `value`, `url?`, `domain?`, `path?`, `secure?`, `httpOnly?`, `sameSite?`, `expires?` | Set a cookie. `url` defaults to the tab's current URL. |
| `deleteCookie` | `name`, `url?`, `domain?`, `path?` | Delete one cookie by name. |
| `clearCookies` | - | Delete every cookie visible to the tab's URL - not the whole browser. |
| `getStorage` | `area` (`local`/`session`), `key?` | One value (`null` if absent), or every key/value pair if `key` is omitted. |
| `setStorageItem` | `area`, `key`, `value` | Write one key/value pair. |
| `removeStorageItem` | `area`, `key` | Remove one key. |
| `clearStorage` | `area` | Clear every key in that area. |

---

## A first real run

Setup step 5 proves the wiring. This proves the interesting part - that a page sees a
person rather than a script. Point your client at any page and ask for:

1. `snapshotA11y` - the compact outline, with `eN` refs to target.
2. `realClick {ref:"e3"}` - a trusted click. The tab grows a yellow *"being debugged"*
   banner; that is the CDP attach, and it is meant to be visible.
3. `evaluate {expression:"'ok'"}` - page-context JS, bypassing the content-script CSP.
4. `screenshot` - a PNG in your capture directory *and* returned inline.
5. `record {action:"start"}` … `record {action:"stop", path:"clip.webm"}` - a `.webm`
   of the tab. No toolbar click and no user gesture needed; the toolbar icon is inert
   by design and starts nothing.
6. `detach` - clears the banner.

To see the difference the trusted path makes, install a listener and compare:

```js
// via evaluate
window.__e = []; document.querySelector("button")
  .addEventListener("click", e => window.__e.push(e.isTrusted));
```

`click` reports `false`; `realClick` reports `true`. That contrast is the whole point
of the project, and the browser test lane asserts on it directly.

---

## Running the tests

The suite has **two lanes**, and the split is the point.

### Offline lane - no browser, runs in CI

```sh
npm test        # node test/run.mjs --lane=offline
```

Completes in well under a second and needs nothing but Node. It runs a **real MCP
handshake in-process** against `src/server.js` (via the SDK's in-memory transport), so
it asserts on the surface the server actually publishes:

- every published tool has an extension handler, **and vice versa** - the failure the
  mirrored architecture invites
- no tool name is claimed by two handler groups (they merge by spread, so a duplicate
  would silently lose)
- every tool carries a real description and the universal `tabId`/`frameId`/`expectUrl`
  scope
- **every tool is exercised by at least one test** - add a tool without a test and CI
  fails, no browser required
- the capture path allowlist really refuses `..`, deep `..`, absolute paths, and
  **symlinked** escapes, tested against the real resolver
- the ban list is checked by *behaviour* - it blocks what it claims to and doesn't
  over-block ordinary sites
- the hub binds loopback only, the tokens match on both sides, the manifest requests no
  over-broad permissions, the toolbar icon is inert, and no `*.pem` is committed

### Browser lane - drives real Chrome

```sh
# 1. Disconnect the MCP client (close Claude Code, or disable this server for the run)
# 2. Free port 9876 - the hub is long-lived and outlives the session that spawned it
pkill -f src/hub.js
# 3. Start the suite; it binds 9876 itself and waits for the extension
npm run test:browser
# 4. Reload the extension in chrome://extensions so it connects to the suite
```

> ⚠️ **Step 1 is not optional.** A *connected* MCP client respawns the hub every ~1.2s
> whenever it finds the socket gone, so it takes port 9876 straight back and the suite
> dies with `EADDRINUSE`. Killing the hub while a client is still attached does not
> help - the client just starts another one.

The suite stands up a fixture server and a bridge speaking the **same wire protocol as
the real hub**, so a passing run exercises the actual message contract. Each suite
mirrors a tool group, and every test starts from a reset fixture page - no test
inherits another's mutations.

At the end it prints **tool coverage** and fails if any of the 56 tools went
unexercised.

### Options

| Command | Effect |
| --- | --- |
| `npm test` | offline lane only - the CI gate |
| `npm run test:browser` | browser lane only |
| `npm run test:all` | both |
| `npm run test:list` | list every suite and test without running |
| `node test/run.mjs --grep=fill` | only tests whose suite/name matches |

### Test layout

```
test/
├── run.mjs                    # CLI: lanes, filtering, coverage, reporting
├── lib/
│   ├── runner.js              # suite registry, isolation, timeouts
│   ├── assert.js              # assertions with diagnostic messages
│   ├── wait.js                # eventually() - polling, not fixed sleeps
│   ├── mcp-probe.js           # real in-process MCP handshake
│   ├── bridge.js              # stands in for the hub; tracks tool coverage
│   ├── fixture-server.js      # serves the fixture pages
│   └── page.js                # the browser session + per-test reset
├── fixtures/
│   ├── index.html             # the fixture page (a real file, with __reset())
│   └── frame.html             # child frame, for frameId targeting
└── suites/
    ├── 01-contract.suite.js   # offline
    ├── 02-security.suite.js   # offline
    ├── 10-navigation.suite.js
    ├── 20-tabs.suite.js
    ├── 30-perception.suite.js
    ├── 40-interaction.suite.js
    ├── 50-trusted-input.suite.js
    ├── 60-observability.suite.js
    ├── 70-capture.suite.js
    └── 80-storage.suite.js
```

---

## Security notes

This extension can drive your logged-in browser. Read this section.

- **Loopback only.** The hub binds `127.0.0.1`, so it is **not reachable from the
  LAN** - only from processes on this machine.
- **Token handshake.** A peer must present `AUTH_TOKEN` on connect or the hub drops
  it. **Change it** from the shipped default (identical constant in `src/config.js`
  and `extension/src/config.js`) - it is what stops another local process from
  driving your browser.
- **File writes are confined** to the capture directory.
  `src/capture/capture-path.js` resolves every requested path and refuses anything
  outside it, including via `..` traversal *and* via symlinked subdirectories. This
  matters more than it looks: arbitrary-path writes are effectively code execution.
- **Host ban list.** `BANLIST` in `extension/src/config.js` blocks navigation and
  scripting on sensitive domains (banking, PayPal, Gmail). Adjust it to your needs.
  **Note:** screenshots and recording capture rendered pixels and are *not* filtered
  by the ban list.
- **The debugger banner is a feature.** CDP tools attach `chrome.debugger`, showing a
  persistent yellow *"being debugged"* bar. That is your visible signal that something
  is driving the tab. `detach` removes it.
- **`evaluate` runs arbitrary JS** in the page's real context.
- **Internal pages are off limits** - the extension cannot script `chrome://` or
  `chrome-extension://` URLs.
- **The signing key is not in this repo.** The extension ID is pinned by the *public*
  `key` in `extension/manifest.json`; the matching **private** key must stay outside
  version control (`.gitignore` blocks `*.pem`). It is only needed to re-pack a
  `.crx` under the same ID - loading unpacked does not use it.

---

## Architecture

The server and the extension are **mirrored**. Every tool group in `src/tools/` has a
handler file of the same name in `extension/src/handlers/`. Adding a tool means
touching exactly that pair - its schema and docs on one side, its implementation on
the other.

| Group | Server (schema + docs) | Extension (implementation) |
| --- | --- | --- |
| navigation | `src/tools/navigation.js` | `extension/src/handlers/navigation.js` |
| tabs | `src/tools/tabs.js` | `extension/src/handlers/tabs.js` |
| perception | `src/tools/perception.js` | `extension/src/handlers/perception.js` |
| interaction | `src/tools/interaction.js` | `extension/src/handlers/interaction.js` |
| trusted input | `src/tools/trusted-input.js` | `extension/src/handlers/trusted-input.js` |
| observability | `src/tools/observability.js` | `extension/src/handlers/observability.js` |
| capture | `src/tools/capture.js` | `extension/src/handlers/capture.js` |
| storage | `src/tools/storage.js` | `extension/src/handlers/storage.js` |

Everything else is supporting infrastructure:

- **`bin/custom-chrome-dev-mcp.js`** - the executable you register with your MCP
  client. It does nothing but start the server.
- **`src/config.js`** / **`extension/src/config.js`** - every tunable, one file per
  side. `AUTH_TOKEN` and the port must match across the two.
- **`src/relay/hub-client.js`** - connects to the hub as `role:"mcp"`, spawns it when
  absent, and turns each tool call into a request/response over the socket.
- **`src/hub.js`** - the long-lived relay owning `ws://127.0.0.1:9876`. Holds the one
  extension socket plus every session's client and multiplexes between them. Re-tags
  ids on the wire (they can collide across sessions) and self-exits if a hub already
  owns the port.
- **`src/capture/capture-path.js`** - the write allowlist. Every capture path goes
  through it.
- **`extension/src/connection.js`** - the hub socket plus the heartbeat. An MV3
  service worker is torn down after ~30s idle, which silently drops the socket; a
  sub-30s heartbeat keeps both alive, and an alarm revives the worker after a hard
  kill.
- **`extension/src/tabs.js`** - which tab a call acts on (explicit `tabId` > pinned
  tab > active tab), the `expectUrl` guard, and the ban list check.
- **`extension/src/walker-bridge.js`** + **`extension/src/page/walker.js`** - the
  injected ISOLATED-world script with the stable element-ref system, and the only
  module that knows how to reach it.
- **`extension/src/cdp/`** - `session.js` (attach/detach, `cdp()`, element centres),
  `keyboard.js` (key names → CDP key events), `dialogs.js` (native dialog policy),
  `buffers.js` (console + network ring buffers, capped at 500/tab).
- **`extension/src/recording/`** - `chrome.tabCapture` needs a user gesture an MCP
  call never has, so recording uses CDP screencast instead: JPEG frames relayed to an
  offscreen `MediaRecorder` (the service worker has no DOM).
- **`test/`** - two-lane suite: an offline CI gate that needs no browser, and a
  browser lane that drives real Chrome. See [Running the tests](#running-the-tests).

---

## Project layout

```
.
├── bin/
│   └── custom-chrome-dev-mcp.js   # executable entry - register THIS with your client
├── src/
│   ├── server.js                  # composes config + relay + tool registry
│   ├── config.js                  # port, token, capture dir, timeouts
│   ├── hub.js                     # long-lived relay owning :9876
│   ├── relay/
│   │   └── hub-client.js          # session -> hub socket; call()
│   ├── capture/
│   │   └── capture-path.js        # write allowlist for screenshots/recordings
│   └── tools/                     # ONE FILE PER TOOL GROUP - the public surface
│       ├── index.js               # the registry
│       ├── schemas.js             # shared arg shapes + passthrough helper
│       ├── navigation.js
│       ├── tabs.js
│       ├── perception.js
│       ├── interaction.js
│       ├── trusted-input.js
│       ├── observability.js
│       ├── capture.js
│       └── storage.js
├── extension/                     # Chrome MV3 extension
│   ├── manifest.json
│   └── src/
│       ├── background.js          # service worker entry - wiring only
│       ├── config.js              # token, banlist, buffer caps, asset paths
│       ├── connection.js          # hub socket + MV3 keepalive heartbeat
│       ├── tabs.js                # tab resolution, pinning, ban check
│       ├── walker-bridge.js       # channel to the injected page script
│       ├── cdp/
│       │   ├── session.js         # attach/detach, cdp(), element centres
│       │   ├── keyboard.js        # key names -> CDP key events
│       │   ├── dialogs.js         # native alert/confirm/prompt policy
│       │   └── buffers.js         # console + network ring buffers
│       ├── recording/
│       │   ├── recorder.js        # CDP screencast -> offscreen encoder
│       │   ├── offscreen.html
│       │   └── offscreen.js       # MediaRecorder host
│       ├── page/
│       │   └── walker.js          # injected DOM driver (ISOLATED world)
│       └── handlers/              # MIRRORS src/tools/ - one file per group
│           ├── index.js           # the handler table + dispatch
│           ├── navigation.js
│           ├── tabs.js
│           ├── perception.js
│           ├── interaction.js
│           ├── trusted-input.js
│           ├── observability.js
│           ├── capture.js
│           └── storage.js
└── test/                          # two lanes: offline (CI) + browser
    ├── run.mjs                    # CLI entry
    ├── lib/                       # runner, assertions, bridge, fixtures, session
    ├── fixtures/                  # the fixture pages, as real files
    └── suites/                    # one suite per tool group
```

---

## Credits

Inspired by [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
from the Chrome DevTools team. Independent reimplementation, not affiliated with,
endorsed by, or supported by Google.

---

## License

[MIT](LICENSE). Copyright (c) 2026 Haba Andrei.

Use it, fork it, ship it. The only condition is that the copyright notice and the
permission notice travel with any substantial copy.


[![M8ven Verified](https://m8ven.ai/badge/mcp/habaandrei-custom-chrome-dev-mcp-lcatl0?variant=verified)](https://m8ven.ai/mcp/habaandrei-custom-chrome-dev-mcp-lcatl0)
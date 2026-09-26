# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local-only MCP server (`custom-chrome-dev-mcp`) that drives the user's real Chrome browser via a companion MV3 extension, exposing 45 tools across navigation, tabs, perception, interaction, trusted input, observability, and capture. Its entire premise is behaving like a *human* using the browser (trusted CDP input, real focus, real keystrokes) rather than firing synthetic DOM events — see README.md for the full rationale and tool reference.

## Commands

```sh
npm test              # offline lane only — the CI gate, no browser needed, <1s
npm run test:browser  # browser lane — drives real Chrome
npm run test:all       # both lanes
npm run test:list      # list every suite/test without running
node test/run.mjs --grep=fill   # filter by suite/test name substring
```

Running the browser lane requires freeing port 9876 first (`pkill -f src/hub.js`) and disconnecting any live MCP client, otherwise the client respawns the hub and the suite dies with `EADDRINUSE`. Then reload the extension in `chrome://extensions` so it connects to the test bridge instead of the real hub.

There is no separate lint/build step — `npm test` (the offline lane) is the fast correctness gate and should pass before any change is considered done.

## Architecture

**Transport chain**: `MCP client <-stdio-> bin/custom-chrome-dev-mcp.js <-> src/hub.js (ws://127.0.0.1:9876) <-> Chrome extension <-> active tab`. The hub is a separate long-lived process (not inside the server) because multiple MCP sessions may each want the one browser socket; the first session spawns it detached, later sessions find it already listening. Each session connects as `role:"mcp"`, the extension as `role:"extension"`; the hub multiplexes and re-tags message ids since they can collide across sessions.

**The server and the extension are mirrored 1:1 by tool group.** Every file in `src/tools/` (schema + docs, registered via `src/tools/index.js`) has a same-named handler file in `extension/src/handlers/` (implementation, dispatched via `extension/src/handlers/index.js`). Adding or changing a tool means touching exactly that pair — groups: `navigation`, `tabs`, `perception`, `interaction`, `trustedInput` (file: `trusted-input.js`), `observability`, `capture`, `storage`. The offline test suite asserts the two sides stay in lockstep (every schema has a handler and vice versa, no tool name claimed by two groups, every tool exercised by at least one test).

**Inside the extension**, three layers:
1. **Walker** (`extension/src/page/walker.js`) — injected into the page's ISOLATED world via `walker-bridge.js`; owns element resolution, the stable `eN` ref map, and fast *synthetic* DOM ops (`click`, `type`).
2. **CDP** (`extension/src/cdp/`) — `chrome.debugger`-based trusted input, page-context `evaluate`, screenshots, console/network ring buffers (capped at 500/tab). `session.js` handles attach/detach; `keyboard.js` maps key names to CDP key events; `dialogs.js` is native dialog policy; `buffers.js` is the ring buffers.
3. **Recording** (`extension/src/recording/`) — CDP screencast (JPEG frames) relayed to a `MediaRecorder` in an offscreen document, because `chrome.tabCapture` needs a user gesture an MCP call never has.

**Fast (synthetic) vs. trusted (CDP) input** is the core design axis: `click`/`type` dispatch untrusted events from the walker — fast, work on most sites. `realClick`/`realType`/`press`/`hover`/`drag` go through `chrome.debugger` so the page sees `isTrusted=true` — same as a physical mouse/keyboard, needed when a page checks for it. CDP tools show a persistent yellow "being debugged" banner (`detach` clears it); this is intentional, not a bug to hide.

**Auth & write safety**: `AUTH_TOKEN` is a shared secret defined identically in `src/config.js` and `extension/src/config.js` — the hub drops any peer whose token doesn't match; an offline test asserts the two constants match. `src/capture/capture-path.js` is the write allowlist: every screenshot/recording path is resolved and confined to the capture directory (default `~/Downloads`), refusing `..` traversal, absolute escapes, and symlinked escapes — arbitrary-path writes are effectively code execution, so changes here need the same scrutiny as auth code. `BANLIST` in `extension/src/config.js` blocks navigation/scripting on sensitive domains (screenshots/recording are *not* filtered by it).

**Tab targeting** (`extension/src/tabs.js`): explicit `tabId` > pinned tab (`useTab`) > active tab, plus the `expectUrl` guard and ban-list check. Every tool accepts the universal `tabId`, `frameId`, `expectUrl` params (asserted by the offline suite).

**Config**: `src/config.js` and `extension/src/config.js` each hold every tunable for their side (port, token, capture dir, banlist, buffer caps) — keep the two in sync when changing the port or token.

## Working on this repo

- **Reload discipline differs by half**: edits under `extension/` require clicking reload ↻ in `chrome://extensions` (Chrome keeps the old build loaded otherwise); edits under `src/` require restarting the MCP client (it holds the old tool schemas); edits to `src/hub.js` require `pkill -f src/hub.js` (the long-lived process holds old code, and it respawns on the next tool call).
- **Adding a tool** = adding to both `src/tools/<group>.js` (schema/docs) and `extension/src/handlers/<group>.js` (implementation), plus a test in `test/suites/` — the offline suite fails CI if any tool is missing a handler or a test.
- The offline test suite (`test/suites/01-contract.suite.js`, `02-security.suite.js`) is what enforces the server/extension contract, the auth-token match, the capture-path allowlist, and the ban-list behavior — check these when touching config, capture paths, or tool registration.
- The browser test suite stands up a fixture server + bridge speaking the same wire protocol as the real hub (`test/lib/bridge.js`), and every test starts from a reset fixture page (`test/fixtures/index.html`, `__reset()`) — no test should depend on another's mutated state.
- This project is an independent reimplementation inspired by Chrome DevTools MCP, not a fork or affiliate — avoid language implying endorsement by Google/Chrome team.

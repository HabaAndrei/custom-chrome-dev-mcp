// Injected via chrome.scripting.executeScript on every tool call (ISOLATED world).
// Maintains a per-tab ref map on window.__bmcp and exposes window.__bmcp.run(op, args).
(() => {
  const W = (window.__bmcp ||= { refs: new Map(), nextId: 1 });

  const INTERACTIVE = new Set(["a", "button", "input", "select", "textarea", "summary"]);
  const ROLE_INTERACTIVE = new Set(["button", "link", "checkbox", "radio", "menuitem", "tab", "switch", "option"]);

  function isVisible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function accName(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
      if (t) return t;
    }
    if (el.tagName === "INPUT" && el.labels?.[0]) return el.labels[0].textContent.trim();
    const txt = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    return txt.slice(0, 80);
  }

  function role(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === "a" && el.href) return "link";
    if (t === "button") return "button";
    if (t === "input") return "input:" + (el.type || "text");
    if (t === "select") return "select";
    if (t === "textarea") return "textarea";
    if (/^h[1-6]$/.test(t)) return "heading";
    return t;
  }

  function isInteractive(el) {
    if (INTERACTIVE.has(el.tagName.toLowerCase())) return true;
    const r = el.getAttribute("role");
    if (r && ROLE_INTERACTIVE.has(r)) return true;
    if (el.getAttribute("contenteditable") === "true") return true;
    if (el.tabIndex >= 0 && el.onclick) return true;
    return false;
  }

  function snapshotA11y() {
    W.refs = new Map();
    W.nextId = 1;
    const lines = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = walker.nextNode())) {
      if (!isInteractive(n) || !isVisible(n)) continue;
      const name = accName(n);
      if (!name && n.tagName !== "INPUT" && n.tagName !== "TEXTAREA") continue;
      const id = "e" + W.nextId++;
      W.refs.set(id, new WeakRef(n));
      const extra = n.tagName === "A" && n.href ? " " + n.href : "";
      lines.push(`- ${role(n)} ${JSON.stringify(name)} ref=${id}${extra}`);
      if (lines.length >= 300) break;
    }
    return lines.join("\n");
  }

  function getEl(ref) {
    const el = W.refs.get(ref)?.deref();
    if (!el || !el.isConnected) throw new Error("ref expired: " + ref + " (re-snapshot)");
    return el;
  }

  function setValue(el, txt) {
    // contenteditable / rich editors (Outlook body, chips, Slack, Notion…) have no
    // `.value`; calling the HTMLInputElement value setter on them throws
    // "Illegal invocation". Set text through the editable path instead, firing the
    // beforeinput/input events real editors listen for.
    if (el.isContentEditable) {
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      try { sel.selectAllChildren(el); } catch {}
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, txt); } catch {}
      if (!inserted) {
        el.textContent = txt;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: txt }));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter ? setter.call(el, txt) : (el.value = txt);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    // Fallback for anything else that exposes a value property, else set text.
    if ("value" in el) {
      el.value = txt;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.textContent = txt;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: txt }));
    }
  }

  /** Attributes whose live DOM property diverges from the markup as a user interacts. */
  const LIVE_PROPERTIES = new Set(["value", "checked", "selected", "indeterminate"]);

  // Read an element's current text, treating inputs and contenteditables uniformly.
  function currentValue(el) {
    if (el.isContentEditable) return (el.innerText || el.textContent || "").trim();
    if ("value" in el && el.value != null) return String(el.value);
    return (el.innerText || el.textContent || "").trim();
  }

  function findByName(name) {
    snapshotA11y();
    const lower = name.toLowerCase();
    for (const [, wr] of W.refs) {
      const el = wr.deref();
      if (el && el.isConnected && accName(el) === name) return el;
    }
    for (const [, wr] of W.refs) {
      const el = wr.deref();
      if (el && el.isConnected && accName(el).toLowerCase().startsWith(lower)) return el;
    }
    let best = null, bestLen = Infinity;
    for (const [, wr] of W.refs) {
      const el = wr.deref();
      if (!el || !el.isConnected) continue;
      const n = accName(el);
      if (n.toLowerCase().includes(lower) && n.length < bestLen) { best = el; bestLen = n.length; }
    }
    return best;
  }

  // Target may be: a string (accessible name), {ref}, or {selector}.
  function resolveTarget(t) {
    if (typeof t === "string") {
      const el = findByName(t);
      if (!el) throw new Error("no interactive element named: " + JSON.stringify(t));
      return el;
    }
    if (t && t.ref) return getEl(t.ref);
    if (t && t.selector) {
      const el = document.querySelector(t.selector);
      if (!el) throw new Error("selector not found: " + t.selector);
      return el;
    }
    throw new Error("invalid target: " + JSON.stringify(t));
  }

  function waitFor(target, timeoutMs = 8000) {
    // A readable description of what we're waiting for (used in the timeout error).
    const describe = target == null ? "nothing"
      : typeof target === "string" ? "text/name " + JSON.stringify(target)
      : target.ref ? "ref " + target.ref
      : target.selector ? "selector " + JSON.stringify(target.selector)
      : JSON.stringify(target);
    return new Promise((resolve, reject) => {
      if (target == null)
        return reject(new Error("waitForSelector needs a target: pass selector, ref, name, or text"));
      const t0 = Date.now();
      const tick = () => {
        try {
          if (typeof target === "string") {
            if (document.body.innerText.includes(target) || findByName(target))
              return resolve({ found: true, waitedMs: Date.now() - t0 });
          } else {
            resolveTarget(target);
            return resolve({ found: true, waitedMs: Date.now() - t0 });
          }
        } catch {}
        if (Date.now() - t0 > timeoutMs) return reject(new Error("timeout waiting for " + describe));
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  const HAS_POINTER = typeof PointerEvent === "function";

  /**
   * Event init for a mouse event aimed at an element's centre.
   *
   * `buttons` matters more than it looks: during a real mousedown it reads 1, and 0
   * once released. A naive synthetic click leaves it 0 throughout, which is precisely
   * the kind of inconsistency a page can check for.
   */
  function mouseInit(el, extra) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    return {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, detail: 1, ...extra,
    };
  }

  const pointerInit = (init) => ({
    ...init, pointerId: 1, pointerType: "mouse", isPrimary: true,
    width: 1, height: 1, pressure: init.buttons ? 0.5 : 0,
  });

  /**
   * Dispatch the event sequence a real left click produces, exactly ONCE:
   * pointerover/mouseover -> pointermove/mousemove -> pointerdown/mousedown -> focus
   * -> pointerup/mouseup -> click.
   *
   * Two things this fixes over dispatching a lone `click`:
   *
   * 1. Handlers bound to mousedown/pointerdown — dropdowns, menus, and most component
   *    libraries — never saw anything at all before, so `click` looked like it did
   *    nothing on exactly the widgets people most want to drive.
   * 2. There is no el.click() afterwards. Dispatching `click` already runs the
   *    element's activation behaviour (links navigate, submit buttons submit,
   *    checkboxes toggle), so the old fallback ran every handler a SECOND time —
   *    a double submit on any page whose handler didn't call preventDefault().
   */
  function humanClick(el) {
    const fire = (Ctor, type, init) => {
      const ev = new Ctor(type, init);
      el.dispatchEvent(ev);
      return ev;
    };

    const hover = mouseInit(el, { buttons: 0, detail: 0 });
    if (HAS_POINTER) {
      fire(PointerEvent, "pointerover", pointerInit(hover));
      fire(PointerEvent, "pointerenter", pointerInit({ ...hover, bubbles: false }));
    }
    fire(MouseEvent, "mouseover", hover);
    fire(MouseEvent, "mouseenter", { ...hover, bubbles: false });
    if (HAS_POINTER) fire(PointerEvent, "pointermove", pointerInit(hover));
    fire(MouseEvent, "mousemove", hover);

    const down = mouseInit(el, { buttons: 1 });
    if (HAS_POINTER) fire(PointerEvent, "pointerdown", pointerInit(down));
    const md = fire(MouseEvent, "mousedown", down);

    // A real browser moves focus on mousedown, and skips it when the handler calls
    // preventDefault() — which is how "click here without stealing focus" widgets
    // work. Mirror both halves rather than focusing unconditionally.
    if (!md.defaultPrevented) { try { el.focus({ preventScroll: true }); } catch {} }

    const up = mouseInit(el, { buttons: 0 });
    if (HAS_POINTER) fire(PointerEvent, "pointerup", pointerInit(up));
    fire(MouseEvent, "mouseup", up);
    fire(MouseEvent, "click", mouseInit(el, { buttons: 0 }));
  }

  function doClick(target) {
    const el = resolveTarget(target);
    el.scrollIntoView({ block: "center" });
    humanClick(el);
    return { clicked: typeof target === "string" ? target : target.ref || target.selector, focused: document.activeElement === el };
  }

  function doScroll({ target, direction = "down", amount = 600 }) {
    const el = target ? resolveTarget(target) : null;
    if (el && !target.selector && !target.ref && typeof target !== "string") { /* noop */ }
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "instant" });
      return { scrolledIntoView: true };
    }
    const map = {
      down: [0, amount], up: [0, -amount], right: [amount, 0], left: [-amount, 0],
    };
    if (direction === "top") { window.scrollTo(0, 0); return { scrolledTo: "top" }; }
    if (direction === "bottom") { window.scrollTo(0, document.body.scrollHeight); return { scrolledTo: "bottom" }; }
    const [dx, dy] = map[direction] || map.down;
    window.scrollBy(dx, dy);
    return { scrolledBy: [dx, dy], scrollY: window.scrollY };
  }

  // Ops map. Each receives the args object. May be async (executeScript awaits).
  const ops = {
    // legacy step form used by the native-messaging variant
    step: (a) => runStep(a),

    snapshot: () => snapshotA11y(),
    waitFor: ({ target, timeoutMs }) => waitFor(target, timeoutMs),
    click: ({ target }) => doClick(target),
    type: ({ target, text }) => { const el = resolveTarget(target); el.focus({ preventScroll: true }); setValue(el, text); return { typed: text.length, value: currentValue(el) }; },
    // Composite: scroll into view → focus → set value (input OR contenteditable) →
    // read back. With verify:true, reports whether the field now holds the text, so
    // an agent can confirm the write without a screenshot round-trip.
    fill: ({ target, text, verify = true }) => {
      const el = resolveTarget(target);
      el.scrollIntoView({ block: "center" });
      try { el.focus({ preventScroll: true }); } catch {}
      setValue(el, text);
      const value = currentValue(el);
      const verified = value.trim() === String(text).trim();
      if (verify && !verified) throw new Error(`fill verification failed: field holds ${JSON.stringify(value)}, expected ${JSON.stringify(text)}`);
      return { filled: true, value, verified, focused: document.activeElement === el };
    },
    // Assert an element's text/value without a screenshot. Returns {ok, checks}.
    assert: ({ target, text, value }) => {
      const el = resolveTarget(target);
      const actualText = (el.innerText || el.textContent || "").trim();
      const actualValue = currentValue(el);
      const checks = {};
      let ok = true;
      if (text != null) { const pass = actualText.includes(text); checks.text = { expected: text, actual: actualText.slice(0, 200), ok: pass }; ok = ok && pass; }
      if (value != null) { const pass = actualValue.trim() === String(value).trim(); checks.value = { expected: value, actual: actualValue.slice(0, 200), ok: pass }; ok = ok && pass; }
      return { ok, checks };
    },
    scroll: (a) => doScroll(a),
    // Session-history fallback for the navigation group — see walkHistory() in
    // handlers/navigation.js for why the chrome.tabs API isn't enough on its own.
    historyGo: ({ delta }) => { history.go(delta); return { went: delta }; },
    select: ({ target, value, label }) => {
      const el = resolveTarget(target);
      try { el.focus({ preventScroll: true }); } catch {}
      if (label != null) {
        const opt = [...el.options].find((o) => o.textContent.trim() === label || o.textContent.trim().toLowerCase().startsWith(String(label).toLowerCase()));
        if (!opt) throw new Error("no option labeled: " + label);
        el.value = opt.value;
      } else { el.value = value; }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { selected: el.value };
    },
    check: ({ target, checked }) => {
      const el = resolveTarget(target);
      // Same full sequence as click: a bare el.click() fires no mousedown, so labels
      // and custom checkbox widgets that key off it never react.
      if (!!el.checked !== !!checked) humanClick(el);
      return { checked: !!el.checked };
    },
    submit: ({ target }) => {
      const el = resolveTarget(target);
      const form = el.form || (el.closest && el.closest("form"));
      if (!form) throw new Error("no form for target");
      form.requestSubmit ? form.requestSubmit() : form.submit();
      return { submitted: true };
    },
    getText: ({ target }) => { const el = resolveTarget(target); return (el.innerText || el.textContent || "").trim(); },
    getAttribute: ({ target, name }) => {
      const el = resolveTarget(target);
      // Form state lives on the PROPERTY, not the attribute. The attribute holds only
      // the value the markup shipped with and never changes as text is entered, so
      // <input value=""> would report "" forever however much was typed into it — and
      // an empty attribute is not null, so the fallback below never fired for exactly
      // the fields an agent most needs to read back.
      if (LIVE_PROPERTIES.has(name) && name in el) {
        return el[name] == null ? null : String(el[name]);
      }
      const v = el.getAttribute(name);
      return v != null ? v : (name in el ? String(el[name]) : null);
    },
    queryAll: ({ selector, limit = 50 }) => {
      const out = [...document.querySelectorAll(selector)].slice(0, limit).map((el) => ({
        text: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
        href: el.href || undefined,
        value: el.value || undefined,
        visible: isVisible(el),
      }));
      return { count: out.length, items: out };
    },
    getHtml: () => document.body.outerHTML.slice(0, 50000),
    // Viewport metadata so callers can map screenshot pixels (device px) to the CSS
    // pixels realClick/x,y use: cssX = screenshotX / devicePixelRatio.
    viewport: () => ({
      devicePixelRatio: window.devicePixelRatio,
      cssViewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
    }),
    // Enumerate iframes in THIS document. `src` is readable even for cross-origin
    // frames; `sameOrigin` says whether we can script into it from here. For
    // cross-origin frames, drive the frame directly via its frameId (see listFrames).
    listFramesDom: () => {
      const frames = [...document.querySelectorAll("iframe")].map((f, i) => {
        let sameOrigin = false;
        try { sameOrigin = !!f.contentDocument; } catch { sameOrigin = false; }
        return { index: i, src: f.src || null, name: f.name || null, sameOrigin };
      });
      return { count: frames.length, frames };
    },
    // Resolve a target to its center point in CSS/viewport pixels (for CDP Input).
    rect: ({ target }) => {
      const el = resolveTarget(target);
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height };
    },
    // Resolve TWO targets to their centers in a SINGLE scroll frame. Scrolling to
    // reach the second target would otherwise move the first, making its coordinate
    // stale (the drag press could then land on the wrong element). We scroll once so
    // the union of both elements is centred, then read both rects together.
    dragPoints: ({ from, to }) => {
      const a = resolveTarget(from), b = resolveTarget(to);
      const ra0 = a.getBoundingClientRect(), rb0 = b.getBoundingClientRect();
      const top = Math.min(ra0.top, rb0.top) + window.scrollY;
      const bottom = Math.max(ra0.bottom, rb0.bottom) + window.scrollY;
      const left = Math.min(ra0.left, rb0.left) + window.scrollX;
      const right = Math.max(ra0.right, rb0.right) + window.scrollX;
      window.scrollTo({
        top: Math.max(0, (top + bottom) / 2 - window.innerHeight / 2),
        left: Math.max(0, (left + right) / 2 - window.innerWidth / 2),
        behavior: "instant",
      });
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return {
        from: { x: ra.x + ra.width / 2, y: ra.y + ra.height / 2 },
        to: { x: rb.x + rb.width / 2, y: rb.y + rb.height / 2 },
        bothVisible: ra.top >= 0 && rb.top >= 0 && ra.bottom <= window.innerHeight && rb.bottom <= window.innerHeight,
      };
    },
    eval: ({ expr }) => {
      const v = (0, eval)(expr);
      if (v === undefined) return "undefined";
      if (v === null) return "null";
      if (typeof v === "string") return v;
      try { return JSON.stringify(v); } catch { return String(v); }
    },
  };

  // Legacy single-object step form (native-messaging recipe engine).
  function runStep(step) {
    if ("snapshot" in step) return snapshotA11y();
    if ("wait_for" in step) return waitFor(step.wait_for, step.timeoutMs);
    if ("click" in step) return doClick(step.click);
    if ("type" in step) { const { into, text } = step.type; const el = resolveTarget(into); el.focus(); setValue(el, text); return { typed: text.length }; }
    if ("eval" in step) return ops.eval({ expr: step.eval });
    throw new Error("unknown step keys: " + Object.keys(step).join(","));
  }

  W.run = async (op, args) => {
    try {
      const fn = ops[op];
      if (!fn) throw new Error("unknown op: " + op);
      return await fn(args || {});
    } catch (e) {
      return { __error: String((e && e.message) || e) };
    }
  };
})();

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

function harness() {
  const timers = new Map();
  let timerId = 0;
  let shadow;
  function element() {
    const listeners = new Map();
    return {
      dataset: {},
      style: { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } },
      hidden: true,
      keyboardFocus: false,
      addEventListener(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      },
      emit(name, event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
      setAttribute() {},
      replaceChildren() {},
      append(child) { child.parentElement = this; },
      focus() { shadow.activeElement = this; shadow.emit("focusin"); },
      matches(selector) { assert.equal(selector, ":focus-visible"); return this.keyboardFocus; },
    };
  }
  const nodes = new Map();
  shadow = { ...element(), getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  } };
  const host = { ...element(), attachShadow: () => shadow };
  const document = { ...element(), documentElement: element(), fullscreenElement: null, createElement: () => host };
  const window = { ...element(), innerHeight: 900 };
  const player = { ...element(), querySelector(selector) {
    assert.equal(selector, ".ytp-chrome-bottom");
    return { getBoundingClientRect: () => ({ top: 780 }) };
  } };
  vm.runInNewContext(source, {
    document, window, URL, AbortController,
    location: { href: "https://www.youtube.com/watch?v=abcdefghijk" },
    SEEM_BOX_EXTENSION_URL: "http://localhost:3000",
    seemBoxOpenTranscript: async () => false,
    setTimeout(fn, ms) { assert.equal(ms, 3000); timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    host, shadow, document, player, timers,
    node: (id) => nodes.get(id),
    fullscreen(active) { document.fullscreenElement = active ? player : null; document.emit("fullscreenchange"); },
    idle() {
      const pending = [...timers.values()];
      timers.clear();
      for (const fn of pending) fn();
    },
  };
}

test("moves above fullscreen controls and restores normal placement on exit", () => {
  const h = harness();
  assert.equal(h.host.parentElement, h.document.documentElement);
  assert.equal(h.timers.size, 0);
  h.fullscreen(true);
  assert.equal(h.host.parentElement, h.player);
  assert.equal(h.host.dataset.fullscreen, "true");
  assert.equal(h.host.style["--fullscreen-bottom"], "160px");
  h.idle();
  assert.equal(h.host.dataset.idle, "true");
  h.fullscreen(false);
  assert.equal(h.host.parentElement, h.document.documentElement);
  assert.equal(h.host.dataset.fullscreen, "false");
  assert.equal(h.host.dataset.idle, "false");
  assert.equal(h.host.style["--fullscreen-bottom"], undefined);
  assert.equal(h.timers.size, 0);
});

test("activity reveals the button and resets a single inactivity timer", () => {
  const h = harness();
  h.fullscreen(true);
  h.idle();
  for (const event of ["pointermove", "pointerdown", "keydown"]) {
    h.document.emit(event);
    assert.equal(h.host.dataset.idle, "false");
    h.document.emit(event);
    assert.equal(h.timers.size, 1);
    h.idle();
    assert.equal(h.host.dataset.idle, "true");
  }
});

test("keeps the open summary panel visible and hides after closing it", () => {
  const h = harness();
  h.fullscreen(true);
  h.node("toggle").emit("click");
  assert.equal(h.node("panel").hidden, false);
  h.idle();
  assert.equal(h.host.dataset.idle, "false");
  h.node("close").emit("click");
  assert.equal(h.node("panel").hidden, true);
  h.idle();
  assert.equal(h.host.dataset.idle, "true");
});

test("pointer hover prevents hiding until the pointer leaves", () => {
  const h = harness();
  h.fullscreen(true);
  h.host.emit("pointerenter");
  h.idle();
  assert.equal(h.host.dataset.idle, "false");
  h.host.emit("pointerleave");
  h.idle();
  assert.equal(h.host.dataset.idle, "true");
});

test("keyboard focus reveals a hidden button and keeps it available", () => {
  const h = harness();
  h.fullscreen(true);
  h.idle();
  const toggle = h.node("toggle");
  toggle.keyboardFocus = true;
  toggle.focus();
  assert.equal(h.host.dataset.idle, "false");
  h.idle();
  assert.equal(h.host.dataset.idle, "false");
  h.shadow.activeElement = null;
  h.shadow.emit("focusout");
  h.idle();
  assert.equal(h.host.dataset.idle, "true");
});

test("uses fallback clearance if YouTube controls have not mounted", () => {
  const h = harness();
  h.player.querySelector = () => null;
  h.fullscreen(true);
  assert.equal(h.host.style["--fullscreen-bottom"], "120px");
});

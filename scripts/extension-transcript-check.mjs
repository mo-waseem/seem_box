import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/transcript.js", import.meta.url), "utf8");
const videoId = "abcdefghijk";
const legacyPanelSelector = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]';
const panelSelector = 'ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]:is([target-id="engagement-panel-searchable-transcript"], [target-id="PAmodern_transcript_view"], :has(transcript-segment-view-model))';
const textSelector = 'ytd-transcript-segment-renderer .segment-text, transcript-segment-view-model > span.ytAttributedStringHost';

function harness(overrides = {}, tick = () => {}) {
  const state = {
    href: `https://www.youtube.com/watch?v=${videoId}`,
    mountedId: videoId,
    button: true,
    disabled: false,
    expanded: false,
    text: "",
    clicks: 0,
    waits: 0,
    ...overrides,
  };
  const controller = new AbortController();
  const context = vm.createContext({
    URL,
    location: { get href() { return state.href; } },
    document: {
      querySelector(selector) {
        assert.equal(selector, "ytd-watch-flexy");
        return {
          getAttribute(name) { assert.equal(name, "video-id"); return state.mountedId; },
          querySelector(selector) {
            if ([legacyPanelSelector, panelSelector].includes(selector)) {
              if (state.modernPanel && selector === legacyPanelSelector) return null;
              return state.expanded ? {
                querySelectorAll(selector) {
                  assert.ok(["ytd-transcript-segment-renderer .segment-text", textSelector].includes(selector));
                  if (state.modernPanel && selector !== textSelector) return [];
                  return [{ textContent: state.text }];
                },
              } : null;
            }
            assert.equal(selector, "ytd-video-description-transcript-section-renderer button");
            return state.button ? {
              get disabled() { return state.disabled; },
              getAttribute: () => null,
              click() { state.clicks++; state.expanded = true; },
            } : null;
          },
        };
      },
    },
    setTimeout(resolve, ms) {
      assert.equal(ms, 500);
      state.waits++;
      tick(state, controller);
      resolve();
    },
  });
  vm.runInContext(source, context);
  return { state, controller, run: () => context.seemBoxOpenTranscript(videoId, controller.signal) };
}

test("opens the transcript once and waits for its text", async () => {
  const h = harness({}, (state) => { if (state.waits === 3) state.text = "Transcript loaded"; });
  assert.equal(await h.run(), true);
  assert.equal(h.state.clicks, 1);
  assert.equal(h.state.waits, 3);
});

test("waits for the new video's controls instead of clicking stale controls", async () => {
  const h = harness({ mountedId: "oldVideo123", button: false }, (state) => {
    if (state.waits === 2) {
      assert.equal(state.clicks, 0);
      state.mountedId = videoId;
      state.button = true;
    }
    if (state.expanded) state.text = "New video transcript";
  });
  assert.equal(await h.run(), true);
  assert.equal(h.state.clicks, 1);
});

test("recognizes an already-open modern transcript without clicking again", async () => {
  const h = harness({ modernPanel: true, expanded: true, text: "نص الفيديو" });
  assert.equal(await h.run(), true);
  assert.equal(h.state.clicks, 0);
  assert.equal(h.state.waits, 0);
});

test("waits for modern transcript text after automatically opening it", async () => {
  const h = harness({ modernPanel: true }, (state) => { if (state.waits === 3) state.text = "نص الفيديو"; });
  assert.equal(await h.run(), true);
  assert.equal(h.state.clicks, 1);
  assert.equal(h.state.waits, 3);
});

test("leaves an already-open transcript alone", async () => {
  const h = harness({ expanded: true, text: "Existing transcript" });
  assert.equal(await h.run(), true);
  assert.equal(h.state.clicks, 0);
  assert.equal(h.state.waits, 0);
});

for (const overrides of [{ button: false }, { disabled: true }, { expanded: true }]) {
  test(`gives up after a bounded wait without usable captions: ${JSON.stringify(overrides)}`, async () => {
    const h = harness(overrides);
    assert.equal(await h.run(), false);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.state.waits, 30);
  });
}

test("does not repeatedly reopen a panel the user closes", async () => {
  const h = harness({}, (state) => { state.expanded = false; });
  assert.equal(await h.run(), false);
  assert.equal(h.state.clicks, 1);
});

for (const cancel of [
  (state) => { state.href = "https://www.youtube.com/watch?v=otherVideo1"; },
  (state) => { state.href = "https://www.youtube.com/"; },
  (_state, controller) => { controller.abort(); },
]) {
  test(`stops pending work on navigation or cancellation: ${cancel}`, async () => {
    const h = harness({ button: false }, (state, controller) => {
      state.button = true;
      cancel(state, controller);
    });
    assert.equal(await h.run(), false);
    assert.equal(h.state.clicks, 0);
    assert.equal(h.state.waits, 1);
  });
}

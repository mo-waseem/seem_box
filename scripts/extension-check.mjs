import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
const videoId = "abcdefghijk";
const token = "private-pairing-token-do-not-expose";
const captionUrl = "https://www.youtube.com/api/timedtext?v=abcdefghijk";
const sender = { id: "extension-id", tab: { id: 42 }, url: `https://www.youtube.com/watch?v=${videoId}` };
const payload = { videoId, title: "Example", author: "Channel", transcript: "Hello world" };
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(options = {}) {
  const calls = { access: [], storage: [], scripts: [], captions: [], backend: [], selectors: [], timeouts: [] };
  let listener;
  const response = options.playerResponse ?? {
    videoDetails: { videoId, title: "Example", author: "Channel" },
    captions: { playerCaptionsTracklistRenderer: { captionTracks: options.tracks ?? [{ languageCode: "en", baseUrl: captionUrl }] } },
  };
  const page = vm.createContext({
    URL,
    location: { href: options.href ?? sender.url },
    AbortSignal: { timeout: (ms) => ({ timeout: ms }) },
    document: {
      getElementById(id) {
        assert.equal(id, "movie_player");
        return { getPlayerResponse: () => response };
      },
      querySelector(selector) {
        calls.selectors.push(selector);
        assert.equal(selector, 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
        return options.panel ? {
          querySelectorAll(segmentSelector) {
            assert.equal(segmentSelector, "ytd-transcript-segment-renderer .segment-text");
            return options.panel.map((textContent) => ({ textContent }));
          },
        } : null;
      },
    },
    DOMParser: options.DOMParser,
    async fetch(url, init) {
      calls.captions.push({ url: String(url), init });
      if (options.captionError) throw options.captionError;
      return {
        ok: (options.captionStatus ?? 200) === 200,
        status: options.captionStatus ?? 200,
        text: async () => options.raw ?? JSON.stringify({ events: [{ segs: [{ utf8: "Hello world" }] }] }),
      };
    },
  });
  vm.runInNewContext(source, {
    URL,
    setInterval,
    clearInterval,
    AbortSignal: { timeout: (ms) => { calls.timeouts.push(ms); return { timeout: ms }; } },
    chrome: {
      runtime: { id: sender.id, getPlatformInfo: async () => ({}), onMessage: { addListener(fn) { assert.equal(listener, undefined); listener = fn; } } },
      storage: { local: {
        setAccessLevel(value) { calls.access.push(plain(value)); return options.storageReady ?? Promise.resolve(); },
        async get(key) { calls.storage.push(key); return { token: options.token === undefined ? token : options.token }; },
      } },
      scripting: { async executeScript(injection) {
        calls.scripts.push(injection);
        if (options.scriptError) throw options.scriptError;
        if (options.noExecution) return [];
        // Recreate the injected function without the service worker's globals or closure.
        const fn = vm.runInContext(`(${injection.func.toString()})`, page);
        return [{ result: await fn(...injection.args) }];
      } },
    },
    async fetch(url, init) {
      calls.backend.push({ url, init });
      if (options.backendError) throw options.backendError;
      return {
        ok: (options.backendStatus ?? 200) < 400,
        status: options.backendStatus ?? 200,
        async json() {
          if (options.jsonError) throw options.jsonError;
          return options.backendData ?? { summary: "A concise summary" };
        },
      };
    },
  }, { filename: "extension/background.js" });
  return {
    calls,
    listener,
    async send(message = { type: "READ_CAPTIONS", videoId }) {
      const result = await new Promise((resolve) => {
        assert.equal(listener(message, sender, resolve), true);
      });
      return plain(result);
    },
  };
}

test("JSON3 joins segments without inserting spaces, joins events, and normalizes whitespace", async () => {
  const h = harness({
    tracks: [
      { languageCode: "fr", baseUrl: `${captionUrl}&lang=fr` },
      { languageCode: "en", kind: "asr", baseUrl: `${captionUrl}&kind=asr` },
      { languageCode: "en", baseUrl: `${captionUrl}&lang=en&fmt=old` },
    ],
    raw: JSON.stringify({ events: [{}, { segs: [{ utf8: " Hel" }, { utf8: "lo\n" }, {}] }, { segs: [{ utf8: " world\t! " }] }] }),
  });
  assert.deepEqual(await h.send(), { ...payload, transcript: "Hello world !" });
  assert.deepEqual(h.calls.access, [{ accessLevel: "TRUSTED_CONTEXTS" }]);
  assert.deepEqual(h.calls.storage, []);
  assert.equal(h.calls.scripts.length, 1);
  const injection = h.calls.scripts[0];
  assert.deepEqual(plain(injection.target), { tabId: 42 });
  assert.equal(injection.world, "MAIN");
  assert.equal(typeof injection.func, "function");
  assert.deepEqual(plain(injection.args), [videoId]);
  assert.equal(JSON.stringify(injection).includes(token), false);
  assert.equal(h.calls.captions.length, 1);
  const request = h.calls.captions[0];
  assert.equal(new URL(request.url).searchParams.get("lang"), "en");
  assert.equal(new URL(request.url).searchParams.get("fmt"), "json3");
  assert.equal(request.init.credentials, "include");
  assert.equal(request.init.signal.timeout, 20000);
  assert.equal(h.calls.backend.length, 0);
});

for (const raw of ["", '{"events":[]}', '{"events":[{"segs":[{"utf8":" \\n "}]}]}', "unsupported data"]) {
  test(`empty/unsupported captions give actionable guidance: ${JSON.stringify(raw)}`, async () => {
    const { error } = await harness({ raw }).send();
    assert.match(error, /empty or unsupported caption data/);
    assert.match(error, /Open YouTube's Show transcript panel and retry, or paste the transcript below/);
  });
}

for (const options of [
  { href: "https://www.youtube.com/watch?v=otherVideo1" },
  { playerResponse: { videoDetails: { videoId: "otherVideo1" } } },
]) {
  test(`wrong video is rejected before fetching or reading the panel: ${JSON.stringify(options)}`, async () => {
    const h = harness({ ...options, panel: ["Stale transcript"] });
    assert.match((await h.send()).error, /video changed|player to load/);
    assert.equal(h.calls.captions.length, 0);
    assert.equal(h.calls.selectors.length, 0);
  });
}

for (const options of [{ tracks: [] }, { captionStatus: 403 }, { raw: "" }, { captionError: new Error("Network failed") }]) {
  test(`already-open DOM transcript is a fallback: ${JSON.stringify(options)}`, async () => {
    const h = harness({ ...options, panel: [" Hello\n", " world \t"] });
    assert.deepEqual(await h.send(), payload);
    assert.equal(h.calls.selectors.length, 1);
  });
}

for (const baseUrl of [
  "https://evil.example/api/timedtext",
  "https://www.youtube.com.evil.example/api/timedtext",
  "https://www.youtube.com@evil.example/api/timedtext",
  "http://www.youtube.com/api/timedtext",
  "https://www.youtube.com/api/timedtext/extra",
  "https://youtube.com/api/timedtext",
]) {
  test(`strict caption URL validation prevents fetch: ${baseUrl}`, async () => {
    const h = harness({ tracks: [{ languageCode: "en", baseUrl }] });
    assert.match((await h.send()).error, /unsupported caption URL/);
    assert.equal(h.calls.captions.length, 0);
    assert.equal(h.calls.backend.length, 0);
  });
}

test("XML captions use DOMParser text content and normalize whitespace", async () => {
  const raw = '<transcript><text>Hello &amp;\n</text><text> world</text></transcript>';
  let parsed = false;
  const h = harness({ raw, DOMParser: class {
    parseFromString(input, type) {
      parsed = true;
      assert.equal(input, raw);
      assert.equal(type, "text/xml");
      return {
        querySelector(selector) { assert.equal(selector, "parsererror"); return null; },
        querySelectorAll(selector) {
          assert.equal(selector, "text, p");
          return [{ textContent: "Hello &\n" }, { textContent: " world" }];
        },
      };
    }
  } });
  assert.equal((await h.send()).transcript, "Hello & world");
  assert.equal(parsed, true);
});

test("malformed XML is not accepted as a transcript", async () => {
  const h = harness({ raw: "<broken>", DOMParser: class {
    parseFromString() {
      return {
        querySelector: () => ({}),
        querySelectorAll: () => assert.fail("Must not extract text from malformed XML"),
      };
    }
  } });
  assert.match((await h.send()).error, /empty or unsupported caption data/);
});

test("summary waits for storage protection and authenticates only the backend request", async () => {
  let ready;
  const h = harness({ storageReady: new Promise((resolve) => { ready = resolve; }) });
  const pending = h.send({ type: "SUMMARIZE", videoId, payload });
  assert.equal(h.calls.storage.length, 0);
  assert.equal(h.calls.backend.length, 0);
  ready();
  const result = await pending;
  assert.deepEqual(result, { summary: "A concise summary" });
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.deepEqual(h.calls.storage, ["token"]);
  assert.equal(h.calls.scripts.length, 0);
  assert.equal(h.calls.backend.length, 1);
  const request = h.calls.backend[0];
  assert.equal(request.url, "https://seem-box.waseemkn96.workers.dev/api/extension-summary");
  assert.equal(request.init.method, "POST");
  assert.deepEqual(plain(request.init.headers), { "Content-Type": "application/json", Authorization: `Bearer ${token}` });
  assert.deepEqual(JSON.parse(request.init.body), payload);
  assert.equal(request.init.body.includes(token), false);
  assert.deepEqual(h.calls.timeouts, [300000]);
});

for (const [options, expected] of [
  [{ token: "" }, /toolbar icon.*pairing token/],
  [{ backendError: new Error("fetch failed") }, /Cannot reach seem_box.*https:\/\/seem-box\.waseemkn96\.workers\.dev/],
  [{ backendError: Object.assign(new Error("expired"), { name: "TimeoutError" }) }, /timed out.*shorter transcript/],
  [{ backendStatus: 401, backendData: { error: "Invalid pairing token" } }, /Invalid pairing token/],
  [{ backendStatus: 503, backendData: {} }, /Summary failed \(503\)/],
  [{ jsonError: new SyntaxError("Invalid JSON") }, /Invalid JSON/],
]) {
  test(`summary error handling: ${expected}`, async () => {
    const h = harness(options);
    const result = await h.send({ type: "SUMMARIZE", videoId, payload });
    assert.match(result.error, expected);
    assert.equal(JSON.stringify(result).includes(token), false);
    if (options.token === "") assert.equal(h.calls.backend.length, 0);
  });
}

test("invalid messages and untrusted senders cannot trigger work", () => {
  const h = harness();
  for (const [message, origin] of [
    [{ type: "READ_CAPTIONS", videoId }, { ...sender, id: "other-extension" }],
    [{ type: "READ_CAPTIONS", videoId }, { ...sender, tab: undefined }],
    [{ type: "READ_CAPTIONS", videoId }, { ...sender, url: "https://www.youtube.com.evil.example/" }],
    [{ type: "OTHER", videoId }, sender],
  ]) {
    assert.equal(h.listener(message, origin, () => assert.fail("Unexpected response")), undefined);
  }
  assert.equal(h.calls.storage.length + h.calls.scripts.length + h.calls.backend.length, 0);
});

test("invalid video IDs and summary payloads are rejected before network access", async () => {
  for (const message of [
    { type: "READ_CAPTIONS", videoId: "invalid" },
    { type: "SUMMARIZE", videoId, payload: { ...payload, videoId: "otherVideo1" } },
    { type: "SUMMARIZE", videoId, payload: { ...payload, transcript: 123 } },
    { type: "SUMMARIZE", videoId, payload: { ...payload, transcript: "x".repeat(500001) } },
    { type: "SUMMARIZE", videoId },
  ]) {
    const h = harness();
    assert.match((await h.send(message)).error, /watch page first|Invalid transcript/);
    assert.equal(h.calls.backend.length + h.calls.scripts.length, 0);
  }
});

test("missing script execution produces reload guidance", async () => {
  assert.match((await harness({ noExecution: true }).send()).error, /Reload the page and retry/);
});

for (const backendStatus of [200, 401]) {
  test(`never returns a pairing token echoed by the backend (${backendStatus})`, async () => {
    const h = harness({
      backendStatus,
      backendData: backendStatus === 200 ? { summary: "Summary", token } : { error: `Rejected Bearer ${token}` },
    });
    const result = await h.send({ type: "SUMMARIZE", videoId, payload });
    assert.equal(JSON.stringify(result).includes(token), false, "Backend responses must not expose the pairing token to the content script");
  });
}

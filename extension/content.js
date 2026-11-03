/* global chrome */
(() => {
  const I18N = globalThis.SeemBoxI18n || null;
  const FALLBACK_EN = {
    dir: "ltr", uiShort: "EN", uiName: "English",
    appName: "Youtube AI Summary", close: "Close",
    openPanel: "Open AI summary", closePanel: "Close AI summary",
    summarize: "Summarize", summarizeVideo: "Summarize Video",
    ready: "Ready to read this video's captions.",
    privacyNote: "On click, captions and video details are sent to",
    privacyNoteSuffix: "and its configured AI provider. YouTube cookies stay in your browser.",
    summaryLangLabel: "Summary language", uiLangLabel: "Interface language",
    readingCaptions: "Reading captions...", readingYoutube: "Reading YouTube captions...",
    waitingTranscript: "Waiting for YouTube's transcript panel...",
    preparing: "Preparing transcript...", creating: "Creating your summary...",
    summarizing: (chars) => `Summarizing ${chars} characters. This may take a few minutes...`,
    completed: (provider, model) => `Completed with ${provider} / ${model}.`,
    helpSummary: "Having trouble reading captions?",
    helpIntro: "We try to open YouTube's transcript automatically when you open a video. If captions are empty or unavailable:",
    helpStep1: "Expand the video's description and click Show transcript.",
    helpStep2: "Wait for the transcript text to appear and leave the panel open.",
    helpStep3: "Click Summarize Video again.",
    helpFail: "If it still fails, use Paste a transcript instead below. Videos without a transcript need pasted text.",
    pasteSummary: "Paste a transcript instead", transcriptLabel: "Transcript text",
    transcriptPlaceholder: "Paste captions or transcript text", pasteButton: "Summarize Pasted Text",
    extensionReloaded: "The extension was reloaded. Reload this YouTube tab and try again.",
    pasteFirst: "Paste a transcript first.",
  };
  const normalizeUi = (value) => I18N
    ? I18N.normalizeUiLang(value)
    : (String(value || "").split(/[-_]/)[0].toLowerCase() === "ar" ? "ar" : "en");
  function detectUi() {
    if (I18N) return I18N.detectUiLang();
    try {
      const fromChrome = (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function")
        ? chrome.i18n.getUILanguage()
        : "";
      if (fromChrome) return normalizeUi(fromChrome);
    } catch {
      // Fall through to navigator.
    }
    try {
      if (typeof navigator !== "undefined" && navigator.language) return normalizeUi(navigator.language);
    } catch {
      // Ignore and default to English.
    }
    return "en";
  }
  const uiStrings = (lang) => (I18N ? I18N.stringsFor(lang) : FALLBACK_EN);

  const host = document.createElement("div");
  host.id = "seem-box-extension";
  const shadow = host.attachShadow({ mode: "closed" });
  const spark = `<svg class="spark" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 3 2.3 6.7L19 12l-6.7 2.3L10 21l-2.3-6.7L1 12l6.7-2.3L10 3Z" fill="currentColor"/><path d="m19 1 1.1 3.9L24 6l-3.9 1.1L19 11l-1.1-3.9L14 6l3.9-1.1L19 1Z" fill="currentColor" opacity=".6"/></svg>`;
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 20px; bottom: 24px; z-index: 2147483647; font: 14px/1.5 system-ui, sans-serif; color: #eae8e2; opacity: 1; transition: opacity .2s ease; }
      :host([data-idle="true"]) { opacity: 0; pointer-events: none; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button { font: inherit; cursor: pointer; border: 1px solid #55574e; border-radius: 8px; padding: 9px 14px; color: inherit; background: #292b26; }
      button:hover { background: #3b3e34; }
      button:focus-visible, textarea:focus-visible { outline: 2px solid #d2ee91; outline-offset: 3px; }
      button:disabled { opacity: .7; cursor: wait; }
      .spark { flex: none; }
      #toggle { display: flex; align-items: center; margin-left: auto; padding: 8px; border-radius: 999px; background: linear-gradient(135deg, #30382a, #191d16); border-color: #687d48; box-shadow: 0 6px 24px #0005, inset 0 1px 0 #e3ffc51a; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
      #toggle:hover { transform: translateY(-2px); border-color: #c5e88c; box-shadow: 0 8px 28px #0006, 0 0 20px #c5e88c18; }
      #toggle[aria-expanded="true"] { border-color: #d2ee91; }
      .spark-tile { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(145deg, #e1fbb4, #b5d777); color: #273719; }
      .toggle-label { font-weight: 650; letter-spacing: -.2px; }
      .toggle-copy { display: flex; align-items: center; gap: 11px; max-width: 0; margin-inline-start: 0; overflow: hidden; opacity: 0; white-space: nowrap; transition: max-width .18s ease, margin-inline-start .18s ease, opacity .18s ease; }
      #toggle:hover .toggle-copy, #toggle:focus-visible .toggle-copy { max-width: 160px; margin-inline-start: 11px; opacity: 1; }
      .ai-badge { border: 1px solid #d2ee9133; border-radius: 5px; padding: 1px 5px; color: #d2ee91; font-size: 10px; font-weight: 700; letter-spacing: .8px; }
      #summarize { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 46px; border-radius: 10px; background: linear-gradient(120deg, #e0f8b4, #c2e687); color: #1c2a10; border-color: #d2ee91; font-weight: 650; box-shadow: inset 0 1px 0 #ffffff60, 0 3px 12px #0003; transition: filter .18s ease, transform .18s ease; }
      #summarize:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
      #summarize:active:not(:disabled), #toggle:active { transform: translateY(0); }
      #summarize[aria-busy="true"] .spark { animation: breathe 1.5s ease-in-out infinite; }
      @keyframes breathe { 50% { opacity: .35; transform: scale(.85); } }
      @media (prefers-reduced-motion: reduce) { :host, #toggle, #summarize, .toggle-copy { transition: none; } #summarize[aria-busy="true"] .spark { animation: none; } }
      @media (max-width: 480px) { :host { right: 12px; bottom: 16px; } }
      :host([data-fullscreen="true"]) { bottom: var(--fullscreen-bottom, 120px); }
      :host([data-fullscreen="true"]) section { max-height: min(720px, calc(100dvh - var(--fullscreen-bottom, 120px) - 80px)); }
      section { width: min(400px, calc(100vw - 32px)); max-height: min(720px, calc(100dvh - 110px)); overflow: auto; background: #191b17; border: 1px solid #494d40; border-radius: 14px; padding: 20px; margin-bottom: 12px; box-shadow: 0 12px 48px #0008; }
      section[dir="rtl"] { text-align: right; }
      section[dir="rtl"] ul, section[dir="rtl"] ol { padding-left: 0; padding-right: 20px; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .header-actions { display: flex; align-items: center; gap: 8px; flex: none; }
      #ui-btn { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-size: 12px; font-weight: 650; border-radius: 999px; }
      h2 { font-size: 18px; letter-spacing: -.4px; margin: 0; } h3 { font-size: 14px; color: #d2ee91; margin: 20px 0 6px; }
      p { margin: 12px 0; white-space: pre-wrap; } small { color: #b6bbab; }
      textarea { width: 100%; min-height: 110px; resize: vertical; background: #10120e; color: #eae8e2; border: 1px solid #55574e; border-radius: 6px; padding: 10px; font: inherit; margin: 10px 0; }
      summary { cursor: pointer; margin-top: 16px; } ul { padding-left: 20px; } li { margin: 8px 0; }
      #status[data-error="true"] { color: #ffb4a4; }
    </style>
    <section id="panel" aria-label="Youtube AI Summary" hidden>
      <header><h2 id="app-title">Youtube AI Summary</h2><div class="header-actions"><button id="ui-btn" title="Interface language"><span id="ui-current">EN</span></button><button id="close" aria-label="Close AI summary">Close</button></div></header>
      <p id="video"></p>
      <small><span id="privacy-prefix"></span> <span id="server-host"></span> <span id="privacy-suffix"></span></small>
      <p id="status" role="status" aria-live="polite"></p>
      <button id="summarize" aria-busy="false">${spark}<span id="summarize-label">Summarize Video</span></button>
      <details id="caption-help"><summary id="help-summary">Having trouble reading captions?</summary>
        <p id="help-intro">We try to open YouTube's transcript automatically when you open a video. If captions are empty or unavailable:</p>
        <ol><li id="help-step-1">Expand the video's description and click <strong>Show transcript</strong>.</li><li id="help-step-2">Wait for the transcript text to appear and leave the panel open.</li><li id="help-step-3">Click <strong>Summarize Video</strong> again.</li></ol>
        <p id="help-fail">If it still fails, use <strong>Paste a transcript instead</strong> below. Videos without a transcript need pasted text.</p>
      </details>
      <details><summary id="paste-summary">Paste a transcript instead</summary>
        <label id="transcript-label" for="transcript">Transcript text</label>
        <textarea id="transcript" maxlength="500000" placeholder="Paste captions or transcript text"></textarea>
        <button id="paste">Summarize Pasted Text</button>
      </details>
      <div id="result"></div>
    </section>
    <button id="toggle" aria-label="Open AI summary" aria-expanded="false" aria-controls="panel"><span class="spark-tile">${spark}</span><span class="toggle-copy" aria-hidden="true"><span class="toggle-label" id="toggle-label">Summarize</span><span class="ai-badge">AI</span></span></button>`;
  document.documentElement.append(host);
  const $ = (id) => shadow.getElementById(id);

  async function sendMessage(message) {
    // Reloading the extension orphans this tab's content script: chrome.runtime
    // becomes undefined and every sendMessage throws a bare TypeError.
    if (typeof chrome === "undefined" || chrome.runtime?.id === undefined) {
      throw new Error(uiStrings(uiLang).extensionReloaded);
    }
    return chrome.runtime.sendMessage(message);
  }
  $("server-host").textContent = globalThis.SEEM_BOX_EXTENSION_URL;
  let idleTimer;
  let hovering = false;
  function showControls() {
    clearTimeout(idleTimer);
    host.dataset.idle = "false";
    if (!document.fullscreenElement) return;
    idleTimer = setTimeout(() => {
      // Do not interrupt reading, pointer interaction, or keyboard focus.
      if ($("panel").hidden && !hovering && !shadow.activeElement?.matches(":focus-visible")) {
        host.dataset.idle = "true";
      }
    }, 3000);
  }
  function syncFullscreen() {
    const fullscreen = document.fullscreenElement;
    const parent = fullscreen || document.documentElement;
    // Fullscreen elements are in the browser's top layer; z-index alone is insufficient.
    if (host.parentElement !== parent) {
      const focused = shadow.activeElement;
      parent.append(host);
      focused?.focus({ preventScroll: true });
      hovering = false;
    }
    host.dataset.fullscreen = String(Boolean(fullscreen));
    if (fullscreen) {
      const controls = fullscreen.querySelector(".ytp-chrome-bottom");
      const top = controls?.getBoundingClientRect().top;
      const bottom = top > 0 && top < window.innerHeight ? Math.max(120, window.innerHeight - top + 40) : 120;
      host.style.setProperty("--fullscreen-bottom", `${bottom}px`);
    } else {
      host.style.removeProperty("--fullscreen-bottom");
    }
    showControls();
  }
  document.addEventListener("fullscreenchange", syncFullscreen);
  window.addEventListener("resize", syncFullscreen);
  for (const event of ["pointermove", "pointerdown", "keydown"]) {
    document.addEventListener(event, showControls, { capture: true, passive: true });
  }
  host.addEventListener("pointerenter", () => { hovering = true; showControls(); });
  host.addEventListener("pointerleave", () => { hovering = false; showControls(); });
  shadow.addEventListener("focusin", showControls);
  shadow.addEventListener("focusout", showControls);
  let videoId = null;
  let generation = 0;
  let transcriptController;
  let transcriptReady = Promise.resolve(false);
  let uiLang = detectUi();
  // The summary language always follows the interface language.
  let language = uiLang;
  let lastPayload = null;
  let lastMeta = null;
  let hasResult = false;
  const getId = () => {
    const url = new URL(location.href);
    const id = url.searchParams.get("v");
    return url.pathname === "/watch" && /^[a-zA-Z0-9_-]{11}$/.test(id || "") ? id : null;
  };
  function applyUi() {
    const s = uiStrings(uiLang);
    const dir = s.dir === "rtl" ? "rtl" : "ltr";
    const panel = $("panel");
    panel.setAttribute("aria-label", s.appName);
    panel.setAttribute("dir", dir);
    panel.setAttribute("lang", uiLang);
    $("toggle").setAttribute("dir", dir);
    $("app-title").textContent = s.appName;
    $("toggle-label").textContent = s.summarize;
    $("toggle").setAttribute("aria-label", panel.hidden ? s.openPanel : s.closePanel);
    $("close").textContent = s.close;
    $("close").setAttribute("aria-label", s.closePanel);
    $("privacy-prefix").textContent = s.privacyNote;
    $("privacy-suffix").textContent = s.privacyNoteSuffix;
    $("summarize-label").textContent = $("summarize").disabled ? $("summarize-label").textContent : s.summarizeVideo;
    $("ui-current").textContent = s.uiShort;
    $("ui-btn").setAttribute("aria-label", `${s.uiLangLabel}: ${s.uiName}`);
    $("ui-btn").setAttribute("title", s.uiLangLabel);
    $("help-summary").textContent = s.helpSummary;
    $("help-intro").textContent = s.helpIntro;
    $("help-step-1").textContent = s.helpStep1;
    $("help-step-2").textContent = s.helpStep2;
    $("help-step-3").textContent = s.helpStep3;
    $("help-fail").textContent = s.helpFail;
    $("paste-summary").textContent = s.pasteSummary;
    $("transcript-label").textContent = s.transcriptLabel;
    $("transcript").placeholder = s.transcriptPlaceholder;
    $("paste").textContent = s.pasteButton;
    // Re-render the idle status in the new interface language. Working and
    // error states are left untouched until the next run.
    const status = $("status");
    if (status.dataset.error !== "true" && !$("summarize").disabled) {
      status.textContent = hasResult && lastMeta
        ? s.completed(lastMeta.provider, lastMeta.model)
        : s.ready;
    }
  }
  function updateVideo() {
    const next = getId();
    host.style.display = next ? "block" : "none";
    if (next === videoId) return;
    videoId = next;
    generation++;
    transcriptController?.abort();
    transcriptController = new AbortController();
    transcriptReady = next
      ? globalThis.seemBoxOpenTranscript(next, transcriptController.signal).catch(() => false)
      : Promise.resolve(false);
    $("result").replaceChildren();
    $("transcript").value = "";
    lastPayload = null;
    lastMeta = null;
    hasResult = false;
    $("caption-help").open = false;
    $("video").textContent = "";
    $("status").textContent = uiStrings(uiLang).ready;
    $("status").dataset.error = "false";
    $("summarize").disabled = $("paste").disabled = false;
    $("summarize").setAttribute("aria-busy", "false");
    $("summarize-label").textContent = uiStrings(uiLang).summarizeVideo;
    syncFullscreen();
  }
  function setUiLang(next, persist) {
    if (next !== "en" && next !== "ar") return;
    if (next === uiLang && !persist) { applyUi(); return; }
    uiLang = next;
    // The summary language always follows the interface language.
    language = next;
    applyUi();
    if (persist !== false) {
      try {
        sendMessage({ type: "SET_UI_LANG", uiLang: next }).catch(() => {});
      } catch {
        // Storage is best-effort; the interface already switched.
      }
    }
  }
  $("ui-btn").addEventListener("click", (event) => {
    event.stopPropagation();
    const next = uiLang === "ar" ? "en" : "ar";
    if (next === uiLang || $("summarize").disabled) return;
    setUiLang(next, true);
    // After a summary exists, re-summarize the same transcript in the other language.
    if (lastPayload) void run(lastPayload.pasted === true);
  });
  function setOpen(open) {
    const s = uiStrings(uiLang);
    $("panel").hidden = !open;
    $("toggle").setAttribute("aria-expanded", String(open));
    $("toggle").setAttribute("aria-label", open ? s.closePanel : s.openPanel);
    if (open) $("close").focus();
    else $("toggle").focus();
    showControls();
  }
  $("toggle").addEventListener("click", () => setOpen($("panel").hidden));
  $("close").addEventListener("click", () => setOpen(false));
  shadow.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });

  async function run(pasted) {
    const s = uiStrings(uiLang);
    updateVideo();
    if (!videoId) return;
    const current = ++generation;
    const id = videoId;
    const isCurrent = () => current === generation && getId() === id;
    $("summarize").disabled = $("paste").disabled = true;
    $("summarize").setAttribute("aria-busy", "true");
    $("summarize-label").textContent = pasted ? s.preparing : s.readingCaptions;
    $("result").replaceChildren();
    $("status").dataset.error = "false";
    $("status").textContent = pasted ? s.preparing : s.readingYoutube;
    try {
      let payload = pasted ? {
        videoId: id,
        title: (document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() || document.title).slice(0, 500),
        author: (document.querySelector("ytd-watch-metadata #channel-name")?.textContent?.trim() || "Unknown channel").slice(0, 300),
        transcript: $("transcript").value.trim(),
      } : await sendMessage({ type: "READ_CAPTIONS", videoId: id, language });
      if (!isCurrent()) return;
      if (!pasted && payload?.error) {
        $("status").textContent = s.waitingTranscript;
        const ready = await transcriptReady;
        if (!isCurrent()) return;
        if (ready) payload = await sendMessage({ type: "READ_CAPTIONS", videoId: id, language });
        if (!isCurrent()) return;
      }
      if (payload?.error) {
        if (!pasted) $("caption-help").open = true;
        throw new Error(payload.error);
      }
      if (!payload?.transcript?.trim()) throw new Error(uiStrings(uiLang).pasteFirst);
      payload = { ...payload, language };
      lastPayload = { ...payload, pasted };
      $("video").textContent = payload.title;
      $("summarize-label").textContent = uiStrings(uiLang).creating;
      const count = payload.transcript.length.toLocaleString(uiLang === "ar" ? "ar-EG" : "en-US");
      $("status").textContent = uiStrings(uiLang).summarizing(count);
      const result = await sendMessage({ type: "SUMMARIZE", videoId: id, payload });
      if (!isCurrent()) return;
      if (!result || result.error) throw new Error(result?.error || "The extension connection was interrupted. Please retry.");
      const rtl = language === "ar";
      const headings = rtl ? ["الملخص", "أهم النقاط", "الخلاصة"] : ["Summary", "Key Takeaways", "Conclusion"];
      const values = [result.summary, result.takeaways, result.conclusion];
      const wrapper = document.createElement("div");
      if (rtl) wrapper.setAttribute("dir", "rtl");
      for (let index = 0; index < headings.length; index += 1) {
        const title = document.createElement("h3");
        title.textContent = headings[index];
        const value = values[index];
        const body = document.createElement(Array.isArray(value) ? "ul" : "p");
        if (Array.isArray(value)) {
          for (const item of value) {
            const li = document.createElement("li");
            li.textContent = item;
            body.append(li);
          }
        } else body.textContent = value || "Not provided.";
        wrapper.append(title, body);
      }
      $("result").append(wrapper);
      lastMeta = { provider: result.provider, model: result.model };
      hasResult = true;
      $("status").textContent = uiStrings(uiLang).completed(result.provider, result.model);
    } catch (error) {
      if (!isCurrent()) return;
      $("status").dataset.error = "true";
      $("status").textContent = error.message || "Something went wrong. Reload YouTube and retry.";
    } finally {
      if (isCurrent()) {
        $("summarize").disabled = $("paste").disabled = false;
        $("summarize").setAttribute("aria-busy", "false");
        $("summarize-label").textContent = uiStrings(uiLang).summarizeVideo;
      }
    }
  }
  $("summarize").addEventListener("click", () => run(false));
  $("paste").addEventListener("click", () => run(true));
  document.addEventListener("yt-navigate-finish", updateVideo);
  window.addEventListener("popstate", updateVideo);
  applyUi();
  updateVideo();
  // Prefer the stored interface language (set from the options page or the
  // panel toggle) over the detected browser language. Best-effort: the panel
  // is already usable in the detected language if this fails.
  try {
    const pending = sendMessage({ type: "GET_UI_LANG" });
    pending.then((response) => {
      if (response && (response.uiLang === "en" || response.uiLang === "ar") && response.uiLang !== uiLang) {
        setUiLang(response.uiLang, false);
      }
    }).catch(() => {});
  } catch {
    // Non-extension contexts (tests) keep the detected language.
  }
})();

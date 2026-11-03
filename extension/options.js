/* global chrome */
(function () {
  const i18n = globalThis.SeemBoxI18n;
  const stringsFor = (lang) => (i18n ? i18n.stringsFor(lang) : null) || {
    dir: "ltr", htmlLang: "en", statusLoadError: "Could not load settings.",
    statusTokenShort: "Use a random pairing token.", statusSaved: "Saved.",
    statusSaveError: "Could not save settings.",
  };
  const normalize = (lang) => (i18n ? i18n.normalizeUiLang(lang) : (String(lang).startsWith("ar") ? "ar" : "en"));
  const detect = () => (i18n ? i18n.detectUiLang() : "en");

  const serverLink = document.getElementById("server-link");
  serverLink.href = `${globalThis.SEEM_BOX_EXTENSION_URL}/settings`;
  serverLink.textContent = globalThis.SEEM_BOX_EXTENSION_URL;
  const tokenInput = document.getElementById("token");
  const status = document.getElementById("status");
  const uiSelect = document.getElementById("ui-lang");
  let uiLang = "en";
  let loaded = false;

  function tokenHelpHtml() {
    if (normalize(uiLang) === "ar") {
      return `استخدم نفس قيمة <code dir="ltr">SEEM_BOX_EXTENSION_TOKEN</code> في الخادم المتصل (في <code dir="ltr">.env.local</code> للخادم المحلي). هذا ليس مفتاح API ولا ملف تعريف ارتباط يوتيوب.`;
    }
    return `Use the same value as the connected server's <code>SEEM_BOX_EXTENSION_TOKEN</code> (in <code>.env.local</code> for a local server). This is not your AI API key or YouTube cookie.`;
  }

  function applyStrings() {
    const s = stringsFor(uiLang);
    document.documentElement.lang = s.htmlLang || uiLang;
    document.documentElement.dir = s.dir || "ltr";
    document.title = `${s.appName || "Youtube AI Summary"} Settings`;
    const set = (id, value) => { const el = document.getElementById(id); if (el && value !== undefined) el.textContent = value; };
    set("app-title", s.appName);
    set("tagline", s.tagline);
    set("connected-label", s.connected);
    set("settings-note", s.settingsNote);
    set("token-label", s.tokenLabel);
    set("save-btn", s.saveConnection);
    set("stored-note", s.storedNote);
    set("ui-lang-label", s.uiLanguageLabel);
    const help = document.getElementById("token-help");
    if (help) help.innerHTML = tokenHelpHtml();
    if (uiSelect.value !== uiLang) uiSelect.value = uiLang;
  }

  function showStatus(message) {
    status.textContent = message;
  }

  async function persistUiLang(next) {
    uiLang = normalize(next);
    applyStrings();
    try {
      await ready;
      const current = await chrome.storage.local.get("uiLang");
      if (current.uiLang !== uiLang) await chrome.storage.local.set({ uiLang });
    } catch {
      // Selecting a language must work even if storage is unavailable.
    }
  }

  const ready = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  ready.then(() => chrome.storage.local.get(["token", "uiLang"])).then(({ token, uiLang: stored }) => {
    tokenInput.value = token || "";
    uiLang = stored ? normalize(stored) : detect();
    loaded = true;
    applyStrings();
  }).catch(() => {
    uiLang = detect();
    applyStrings();
    showStatus(stringsFor(uiLang).statusLoadError);
  });

  // Apply detected language immediately so first paint is not stuck in English.
  uiLang = detect();
  applyStrings();

  uiSelect.addEventListener("change", () => {
    void persistUiLang(uiSelect.value);
    if (loaded && status.textContent) {
      // Re-render a visible status message in the new language where possible.
    }
  });

  document.getElementById("settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    const s = stringsFor(uiLang);
    const token = tokenInput.value.trim();
    if (token.length < 32) {
      showStatus(s.statusTokenShort);
      return;
    }
    try {
      await ready;
      await chrome.storage.local.set({ token });
      showStatus(s.statusSaved);
    } catch {
      showStatus(s.statusSaveError);
    }
  });
})();

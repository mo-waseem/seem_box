// Shared UI strings for the extension options page and YouTube panel.
// Loaded before options.js / content.js in both the popup and content scripts.
// No dependencies: must stay runnable in Node's `vm` test harnesses.
(function () {
  const STRINGS = {
    en: {
      dir: "ltr",
      htmlLang: "en",
      uiName: "English",
      uiShort: "EN",
      appName: "Youtube AI Summary",
      tagline: "Simple summaries. Key takeaways. Just what you need.",
      connected: "Connected server:",
      settingsNote: "Configure its AI provider in Settings.",
      tokenLabel: "Pairing token",
      tokenHelp: "Use the same value as the connected server's SEEM_BOX_EXTENSION_TOKEN (in .env.local for a local server). This is not your AI API key or YouTube cookie.",
      saveConnection: "Save Connection",
      storedNote: "The token is stored locally in this Chrome profile. Only transcript text and video details are sent to your app when you click Summarize.",
      uiLanguageLabel: "Interface language",
      statusLoadError: "Could not load settings. Reopen this window.",
      statusTokenShort: "Use a random pairing token of at least 32 characters.",
      statusSaved: "Saved. Open a YouTube video and click Summarize in the bottom-right corner.",
      statusSaveError: "Could not save settings. Please retry.",
      openPanel: "Open AI summary",
      closePanel: "Close AI summary",
      close: "Close",
      summarize: "Summarize",
      summarizeVideo: "Summarize Video",
      ready: "Ready to read this video's captions.",
      privacyNote: "On click, captions and video details are sent to",
      privacyNoteSuffix: "and its configured AI provider. YouTube cookies stay in your browser.",
      summaryLangLabel: "Summary language",
      uiLangLabel: "Interface language",
      readingCaptions: "Reading captions...",
      readingYoutube: "Reading YouTube captions...",
      waitingTranscript: "Waiting for YouTube's transcript panel...",
      preparing: "Preparing transcript...",
      creating: "Creating your summary...",
      summarizing: (chars) => `Summarizing ${chars} characters. This may take a few minutes...`,
      completed: (provider, model) => `Completed with ${provider} / ${model}.`,
      helpSummary: "Having trouble reading captions?",
      helpIntro: "We try to open YouTube's transcript automatically when you open a video. If captions are empty or unavailable:",
      helpStep1: "Expand the video's description and click Show transcript.",
      helpStep2: "Wait for the transcript text to appear and leave the panel open.",
      helpStep3: "Click Summarize Video again.",
      helpFail: "If it still fails, use Paste a transcript instead below. Videos without a transcript need pasted text.",
      pasteSummary: "Paste a transcript instead",
      transcriptLabel: "Transcript text",
      transcriptPlaceholder: "Paste captions or transcript text",
      pasteButton: "Summarize Pasted Text",
      extensionReloaded: "The extension was reloaded. Reload this YouTube tab and try again.",
      pasteFirst: "Paste a transcript first.",
    },
    ar: {
      dir: "rtl",
      htmlLang: "ar",
      uiName: "العربية",
      uiShort: "ع",
      appName: "ملخص يوتيوب بالذكاء الاصطناعي",
      tagline: "ملخصات بسيطة. أهم النقاط. كل ما تحتاجه فقط.",
      connected: "الخادم المتصل:",
      settingsNote: "اضبط مزوّد الذكاء الاصطناعي في الإعدادات.",
      tokenLabel: "رمز الاقتران",
      tokenHelp: "استخدم نفس قيمة SEEM_BOX_EXTENSION_TOKEN في الخادم المتصل (في .env.local للخادم المحلي). هذا ليس مفتاح API ولا ملف تعريف ارتباط يوتيوب.",
      saveConnection: "حفظ الاتصال",
      storedNote: "يُحفظ الرمز محليًا في ملف Chrome هذا. لا يُرسل إلى تطبيقك عند النقر على تلخيص سوى نص الترجمة وتفاصيل الفيديو.",
      uiLanguageLabel: "لغة الواجهة",
      statusLoadError: "تعذّر تحميل الإعدادات. أعد فتح هذه النافذة.",
      statusTokenShort: "استخدم رمز اقتران عشوائي لا يقل عن 32 حرفًا.",
      statusSaved: "تم الحفظ. افتح فيديو يوتيوب وانقر على تلخيص في الزاوية السفلية.",
      statusSaveError: "تعذّر حفظ الإعدادات. حاول مجددًا.",
      openPanel: "فتح ملخص الذكاء الاصطناعي",
      closePanel: "إغلاق ملخص الذكاء الاصطناعي",
      close: "إغلاق",
      summarize: "تلخيص",
      summarizeVideo: "تلخيص الفيديو",
      ready: "جاهز لقراءة ترجمة هذا الفيديو.",
      privacyNote: "عند النقر، تُرسل الترجمة وتفاصيل الفيديو إلى",
      privacyNoteSuffix: "ومزوّد الذكاء الاصطناعي المضبوط فيه. تبقى ملفات تعريف ارتباط يوتيوب في متصفحك.",
      summaryLangLabel: "لغة الملخص",
      uiLangLabel: "لغة الواجهة",
      readingCaptions: "جارٍ قراءة الترجمة...",
      readingYoutube: "جارٍ قراءة ترجمة يوتيوب...",
      waitingTranscript: "بانتظار لوحة نص يوتيوب...",
      preparing: "جارٍ تجهيز النص...",
      creating: "جارٍ إنشاء الملخص...",
      summarizing: (chars) => `جارٍ تلخيص ${chars} حرفًا. قد يستغرق ذلك بضع دقائق...`,
      completed: (provider, model) => `اكتمل باستخدام ${provider} / ${model}.`,
      helpSummary: "تواجه مشكلة في قراءة الترجمة؟",
      helpIntro: "نحاول فتح نص يوتيوب تلقائيًا عند فتح الفيديو. إذا كانت الترجمة فارغة أو غير متوفرة:",
      helpStep1: "وسّع وصف الفيديو وانقر على عرض النص.",
      helpStep2: "انتظر ظهور النص واترك اللوحة مفتوحة.",
      helpStep3: "انقر على تلخيص الفيديو مجددًا.",
      helpFail: "إذا استمر الفشل، استخدم الصق نصًا بدلًا من ذلك أدناه. الفيديوهات بلا نص تحتاج إلى لصق النص.",
      pasteSummary: "الصق نصًا بدلًا من ذلك",
      transcriptLabel: "نص الترجمة",
      transcriptPlaceholder: "الصق الترجمة أو نص الفيديو",
      pasteButton: "تلخيص النص الملصق",
      extensionReloaded: "أُعيد تحميل الإضافة. حدّث علامة تبويب يوتيوب وحاول مجددًا.",
      pasteFirst: "الصق نص الترجمة أولًا.",
    },
  };

  function normalizeUiLang(value) {
    const code = String(value || "").split(/[-_]/)[0].toLowerCase();
    return code === "ar" ? "ar" : "en";
  }

  function detectUiLang() {
    try {
      const fromChrome = typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function"
        ? chrome.i18n.getUILanguage()
        : "";
      if (fromChrome) return normalizeUiLang(fromChrome);
    } catch {
      // Fall through to navigator.
    }
    try {
      if (typeof navigator !== "undefined" && navigator.language) return normalizeUiLang(navigator.language);
    } catch {
      // Ignore and default to English.
    }
    return "en";
  }

  function stringsFor(lang) {
    return STRINGS[normalizeUiLang(lang)] || STRINGS.en;
  }

  globalThis.SeemBoxI18n = { STRINGS, normalizeUiLang, detectUiLang, stringsFor };
})();

/* global chrome, importScripts */

importScripts("config.js");

// Keep the pairing token out of content scripts and the YouTube page.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

async function readCaptions(videoId, language) {
  try {
    if (new URL(location.href).searchParams.get("v") !== videoId) {
      throw new Error("The video changed. Please try again.");
    }
    const player = document.getElementById("movie_player");
    const response = player?.getPlayerResponse?.();
    if (response?.videoDetails?.videoId !== videoId) {
      throw new Error("Wait for the video player to load, then try again.");
    }
    const metadata = {
      videoId,
      title: String(response.videoDetails.title || videoId).slice(0, 500),
      author: String(response.videoDetails.author || "Unknown channel").slice(0, 300),
    };
    const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    // Inlined (not a shared helper): this function is serialized into the
    // YouTube page, where the service worker's scope is unavailable.
    const preferred = language === "ar" ? "ar" : "en";
    // "ar-SA" style codes still match a bare "ar" preference; English is the fallback.
    const baseCode = (code) => String(code || "").split(/[-_]/)[0].toLowerCase();
    const track = tracks.find((item) => baseCode(item.languageCode) === preferred && item.kind !== "asr")
      || tracks.find((item) => baseCode(item.languageCode) === preferred)
      || tracks.find((item) => item.languageCode === "en" && item.kind !== "asr")
      || tracks.find((item) => item.languageCode === "en") || tracks[0];
    let failure = "No caption tracks were exposed by this video.";
    if (track?.baseUrl) {
      try {
        const url = new URL(track.baseUrl);
        if (url.protocol !== "https:" || url.hostname !== "www.youtube.com" || url.pathname !== "/api/timedtext") {
          throw new Error("YouTube returned an unsupported caption URL.");
        }
        url.searchParams.set("fmt", "json3");
        const result = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20000) });
        if (!result.ok) throw new Error(`YouTube caption request failed (${result.status}).`);
        const raw = await result.text();
        let transcript = "";
        if (raw.trim().startsWith("{")) {
          const data = JSON.parse(raw);
          transcript = (data.events || []).map((event) => (event.segs || []).map((seg) => seg.utf8 || "").join("")).join(" ");
        } else if (raw.trim().startsWith("<")) {
          const xml = new DOMParser().parseFromString(raw, "text/xml");
          if (!xml.querySelector("parsererror")) {
            transcript = [...xml.querySelectorAll("text, p")].map((node) => node.textContent).join(" ");
          }
        }
        transcript = transcript.replace(/\s+/g, " ").trim();
        if (transcript) return { ...metadata, transcript };
        failure = "YouTube returned empty or unsupported caption data.";
      } catch (error) {
        failure = error.message;
      }
    }
    // An already-open transcript is a fallback when timedtext requests are blocked.
    // Modern YouTube panels may omit target-id and use transcript-segment-view-model.
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]:is([target-id="engagement-panel-searchable-transcript"], [target-id="PAmodern_transcript_view"], :has(transcript-segment-view-model))');
    const transcript = [...(panel?.querySelectorAll("ytd-transcript-segment-renderer .segment-text, transcript-segment-view-model > span.ytAttributedStringHost") || [])]
      .map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim();
    if (transcript) return { ...metadata, transcript };
    throw new Error(`${failure} Open YouTube's Show transcript panel and retry, or paste the transcript below.`);
  } catch (error) {
    return { error: error.message || "Could not read this video's captions." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url?.startsWith("https://www.youtube.com/")) return;
  if (message?.type === "GET_UI_LANG" || message?.type === "SET_UI_LANG") {
    (async () => {
      await storageReady;
      if (message.type === "SET_UI_LANG") {
        if (message.uiLang !== "en" && message.uiLang !== "ar") throw new Error("Invalid language (supported: en, ar).");
        await chrome.storage.local.set({ uiLang: message.uiLang });
        return { uiLang: message.uiLang };
      }
      const { uiLang } = await chrome.storage.local.get("uiLang");
      return { uiLang: uiLang === "ar" ? "ar" : "en" };
    })().then(sendResponse, (error) => sendResponse({ error: error.message || "Unexpected extension error." }));
    return true;
  }
  if (message?.type !== "READ_CAPTIONS" && message?.type !== "SUMMARIZE") return;
  // Extension API activity keeps the worker alive while a long summary streams.
  const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
  (async () => {
    await storageReady;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(message.videoId || "")) throw new Error("Open a YouTube watch page first.");
    if (message.type === "READ_CAPTIONS") {
      const language = message.language === undefined ? "en" : message.language;
      if (language !== "en" && language !== "ar") throw new Error("Invalid language (supported: en, ar).");
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: "MAIN",
        func: readCaptions,
        args: [message.videoId, language],
      });
      if (!execution?.result) throw new Error("Could not access the YouTube player. Reload the page and retry.");
      return execution.result;
    }
    const { token } = await chrome.storage.local.get("token");
    if (!token) throw new Error("Click the Youtube AI Summary extension toolbar icon to set your pairing token first.");
    const payload = message.payload;
    if (payload?.videoId !== message.videoId || typeof payload.transcript !== "string" || payload.transcript.length > 500000) {
      throw new Error("Invalid transcript or transcript exceeds 500,000 characters.");
    }
    if (payload.language !== undefined && payload.language !== "en" && payload.language !== "ar") {
      throw new Error("Invalid language (supported: en, ar).");
    }
    let response;
    try {
      response = await fetch(`${globalThis.SEEM_BOX_EXTENSION_URL}/api/extension-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300000),
      });
    } catch (error) {
      throw new Error(error.name === "TimeoutError"
        ? "Summarizing timed out. Try a shorter transcript."
        : `Cannot reach seem_box at ${globalThis.SEEM_BOX_EXTENSION_URL}. Make sure the configured server is running and try again.`);
    }
    const data = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
      typeof value === "string" ? value.replaceAll(token, "[redacted]") : value);
    if (!response.ok) throw new Error(data.error || `Summary failed (${response.status}).`);
    return data;
  })().then(sendResponse, (error) => sendResponse({ error: error.message || "Unexpected extension error." }))
    .finally(() => clearInterval(keepAlive));
  return true;
});

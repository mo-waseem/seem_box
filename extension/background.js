/* global chrome */

// Keep the pairing token out of content scripts and the YouTube page.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

async function readCaptions(videoId) {
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
    const track = tracks.find((item) => item.languageCode === "en" && item.kind !== "asr")
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
    const panel = document.querySelector('ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"][visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
    const transcript = [...(panel?.querySelectorAll("ytd-transcript-segment-renderer .segment-text") || [])]
      .map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim();
    if (transcript) return { ...metadata, transcript };
    throw new Error(`${failure} Open YouTube's Show transcript panel and retry, or paste the transcript below.`);
  } catch (error) {
    return { error: error.message || "Could not read this video's captions." };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url?.startsWith("https://www.youtube.com/")) return;
  if (message?.type !== "READ_CAPTIONS" && message?.type !== "SUMMARIZE") return;
  // Extension API activity keeps the worker alive while a long summary streams.
  const keepAlive = setInterval(() => { void chrome.runtime.getPlatformInfo().catch(() => {}); }, 20000);
  (async () => {
    await storageReady;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(message.videoId || "")) throw new Error("Open a YouTube watch page first.");
    if (message.type === "READ_CAPTIONS") {
      const [execution] = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: "MAIN",
        func: readCaptions,
        args: [message.videoId],
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
    let response;
    try {
      response = await fetch("https://seem-box.waseemkn96.workers.dev/api/extension-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300000),
      });
    } catch (error) {
      throw new Error(error.name === "TimeoutError"
        ? "Summarizing timed out. Try a shorter transcript."
        : "Cannot reach seem_box at https://seem-box.waseemkn96.workers.dev. Check your connection and that the server is available.");
    }
    const data = JSON.parse(JSON.stringify(await response.json()), (_key, value) =>
      typeof value === "string" ? value.replaceAll(token, "[redacted]") : value);
    if (!response.ok) throw new Error(data.error || `Summary failed (${response.status}).`);
    return data;
  })().then(sendResponse, (error) => sendResponse({ error: error.message || "Unexpected extension error." }))
    .finally(() => clearInterval(keepAlive));
  return true;
});

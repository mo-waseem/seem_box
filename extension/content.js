/* global chrome */
(() => {
  const host = document.createElement("div");
  host.id = "seem-box-extension";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 20px; bottom: 24px; z-index: 2147483647; font: 14px/1.5 system-ui, sans-serif; color: #eae8e2; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button { font: inherit; cursor: pointer; border: 1px solid #55574e; border-radius: 8px; padding: 9px 14px; color: inherit; background: #292b26; }
      button:hover { background: #3b3e34; }
      button:focus-visible, textarea:focus-visible { outline: 2px solid #d2ee91; outline-offset: 3px; }
      button:disabled { opacity: .55; cursor: wait; }
      #toggle, #summarize { background: #d2ee91; color: #1c2412; border-color: #d2ee91; font-weight: 650; }
      #toggle { box-shadow: 0 4px 24px #0006; }
      section { width: min(400px, calc(100vw - 32px)); max-height: min(720px, calc(100dvh - 110px)); overflow: auto; background: #191b17; border: 1px solid #494d40; border-radius: 14px; padding: 20px; margin-bottom: 12px; box-shadow: 0 12px 48px #0008; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      h2 { font-size: 19px; margin: 0; } h3 { font-size: 14px; color: #d2ee91; margin: 20px 0 6px; }
      p { margin: 12px 0; white-space: pre-wrap; } small { color: #b6bbab; }
      textarea { width: 100%; min-height: 110px; resize: vertical; background: #10120e; color: #eae8e2; border: 1px solid #55574e; border-radius: 6px; padding: 10px; font: inherit; margin: 10px 0; }
      summary { cursor: pointer; margin-top: 16px; } ul { padding-left: 20px; } li { margin: 8px 0; }
      #status[data-error="true"] { color: #ffb4a4; }
    </style>
    <section id="panel" aria-label="seem_box summary" hidden>
      <header><h2>seem_box</h2><button id="close" aria-label="Close summary panel">Close</button></header>
      <p id="video"></p>
      <small>On click, captions and video details are sent to seem-box.waseemkn96.workers.dev and its configured AI provider. YouTube cookies stay in your browser.</small>
      <p id="status" role="status" aria-live="polite">Ready to read this video's captions.</p>
      <button id="summarize">Summarize Video</button>
      <details><summary>Paste a transcript instead</summary>
        <label for="transcript">Transcript text</label>
        <textarea id="transcript" maxlength="500000" placeholder="Paste captions or transcript text"></textarea>
        <button id="paste">Summarize Pasted Text</button>
      </details>
      <div id="result"></div>
    </section>
    <button id="toggle" aria-expanded="false" aria-controls="panel">Summarize</button>`;
  document.documentElement.append(host);
  const $ = (id) => shadow.getElementById(id);
  let videoId = null;
  let generation = 0;
  const getId = () => {
    const url = new URL(location.href);
    const id = url.searchParams.get("v");
    return url.pathname === "/watch" && /^[a-zA-Z0-9_-]{11}$/.test(id || "") ? id : null;
  };
  function updateVideo() {
    const next = getId();
    host.style.display = next ? "block" : "none";
    if (next === videoId) return;
    videoId = next;
    generation++;
    $("result").replaceChildren();
    $("transcript").value = "";
    $("video").textContent = "";
    $("status").textContent = "Ready to read this video's captions.";
    $("status").dataset.error = "false";
    $("summarize").disabled = $("paste").disabled = false;
  }
  function setOpen(open) {
    $("panel").hidden = !open;
    $("toggle").setAttribute("aria-expanded", String(open));
    if (open) $("close").focus();
    else $("toggle").focus();
  }
  $("toggle").addEventListener("click", () => setOpen($("panel").hidden));
  $("close").addEventListener("click", () => setOpen(false));
  shadow.addEventListener("keydown", (event) => { if (event.key === "Escape") setOpen(false); });

  async function run(pasted) {
    updateVideo();
    if (!videoId) return;
    const current = ++generation;
    const id = videoId;
    const isCurrent = () => current === generation && getId() === id;
    $("summarize").disabled = $("paste").disabled = true;
    $("result").replaceChildren();
    $("status").dataset.error = "false";
    $("status").textContent = pasted ? "Preparing transcript..." : "Reading YouTube captions...";
    try {
      const payload = pasted ? {
        videoId: id,
        title: (document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() || document.title).slice(0, 500),
        author: (document.querySelector("ytd-watch-metadata #channel-name")?.textContent?.trim() || "Unknown channel").slice(0, 300),
        transcript: $("transcript").value.trim(),
      } : await chrome.runtime.sendMessage({ type: "READ_CAPTIONS", videoId: id });
      if (!isCurrent()) return;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.transcript?.trim()) throw new Error("Paste a transcript first.");
      $("video").textContent = payload.title;
      $("status").textContent = `Summarizing ${payload.transcript.length.toLocaleString()} characters. This may take a few minutes...`;
      const result = await chrome.runtime.sendMessage({ type: "SUMMARIZE", videoId: id, payload });
      if (!isCurrent()) return;
      if (!result || result.error) throw new Error(result?.error || "The extension connection was interrupted. Please retry.");
      for (const [heading, value] of [["Summary", result.summary], ["Key Takeaways", result.takeaways], ["Conclusion", result.conclusion]]) {
        const title = document.createElement("h3");
        title.textContent = heading;
        const body = document.createElement(Array.isArray(value) ? "ul" : "p");
        if (Array.isArray(value)) {
          for (const item of value) {
            const li = document.createElement("li");
            li.textContent = item;
            body.append(li);
          }
        } else body.textContent = value || "Not provided.";
        $("result").append(title, body);
      }
      $("status").textContent = `Completed with ${result.provider} / ${result.model}.`;
    } catch (error) {
      if (!isCurrent()) return;
      $("status").dataset.error = "true";
      $("status").textContent = error.message || "Something went wrong. Reload YouTube and retry.";
    } finally {
      if (isCurrent()) $("summarize").disabled = $("paste").disabled = false;
    }
  }
  $("summarize").addEventListener("click", () => run(false));
  $("paste").addEventListener("click", () => run(true));
  document.addEventListener("yt-navigate-finish", updateVideo);
  window.addEventListener("popstate", updateVideo);
  updateVideo();
})();

/* global chrome */
(() => {
  const host = document.createElement("div");
  host.id = "seem-box-extension";
  const shadow = host.attachShadow({ mode: "closed" });
  const spark = `<svg class="spark" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 3 2.3 6.7L19 12l-6.7 2.3L10 21l-2.3-6.7L1 12l6.7-2.3L10 3Z" fill="currentColor"/><path d="m19 1 1.1 3.9L24 6l-3.9 1.1L19 11l-1.1-3.9L14 6l3.9-1.1L19 1Z" fill="currentColor" opacity=".6"/></svg>`;
  shadow.innerHTML = `
    <style>
      :host { all: initial; position: fixed; right: 20px; bottom: 24px; z-index: 2147483647; font: 14px/1.5 system-ui, sans-serif; color: #eae8e2; }
      * { box-sizing: border-box; }
      [hidden] { display: none !important; }
      button { font: inherit; cursor: pointer; border: 1px solid #55574e; border-radius: 8px; padding: 9px 14px; color: inherit; background: #292b26; }
      button:hover { background: #3b3e34; }
      button:focus-visible, textarea:focus-visible { outline: 2px solid #d2ee91; outline-offset: 3px; }
      button:disabled { opacity: .7; cursor: wait; }
      .spark { flex: none; }
      #toggle { display: flex; align-items: center; gap: 11px; margin-left: auto; padding: 8px 12px 8px 8px; border-radius: 999px; background: linear-gradient(135deg, #30382a, #191d16); border-color: #687d48; box-shadow: 0 6px 24px #0005, inset 0 1px 0 #e3ffc51a; transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease; }
      #toggle:hover { transform: translateY(-2px); border-color: #c5e88c; box-shadow: 0 8px 28px #0006, 0 0 20px #c5e88c18; }
      #toggle[aria-expanded="true"] { border-color: #d2ee91; }
      .spark-tile { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(145deg, #e1fbb4, #b5d777); color: #273719; }
      .toggle-label { font-weight: 650; letter-spacing: -.2px; }
      .ai-badge { border: 1px solid #d2ee9133; border-radius: 5px; padding: 1px 5px; color: #d2ee91; font-size: 10px; font-weight: 700; letter-spacing: .8px; }
      #summarize { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; min-height: 46px; border-radius: 10px; background: linear-gradient(120deg, #e0f8b4, #c2e687); color: #1c2a10; border-color: #d2ee91; font-weight: 650; box-shadow: inset 0 1px 0 #ffffff60, 0 3px 12px #0003; transition: filter .18s ease, transform .18s ease; }
      #summarize:hover:not(:disabled) { filter: brightness(1.07); transform: translateY(-1px); }
      #summarize:active:not(:disabled), #toggle:active { transform: translateY(0); }
      #summarize[aria-busy="true"] .spark { animation: breathe 1.5s ease-in-out infinite; }
      @keyframes breathe { 50% { opacity: .35; transform: scale(.85); } }
      @media (prefers-reduced-motion: reduce) { #toggle, #summarize { transition: none; } #summarize[aria-busy="true"] .spark { animation: none; } }
      @media (max-width: 480px) { :host { right: 12px; bottom: 16px; } }
      section { width: min(400px, calc(100vw - 32px)); max-height: min(720px, calc(100dvh - 110px)); overflow: auto; background: #191b17; border: 1px solid #494d40; border-radius: 14px; padding: 20px; margin-bottom: 12px; box-shadow: 0 12px 48px #0008; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      h2 { font-size: 18px; letter-spacing: -.4px; margin: 0; } h3 { font-size: 14px; color: #d2ee91; margin: 20px 0 6px; }
      p { margin: 12px 0; white-space: pre-wrap; } small { color: #b6bbab; }
      textarea { width: 100%; min-height: 110px; resize: vertical; background: #10120e; color: #eae8e2; border: 1px solid #55574e; border-radius: 6px; padding: 10px; font: inherit; margin: 10px 0; }
      summary { cursor: pointer; margin-top: 16px; } ul { padding-left: 20px; } li { margin: 8px 0; }
      #status[data-error="true"] { color: #ffb4a4; }
    </style>
    <section id="panel" aria-label="Youtube AI Summary" hidden>
      <header><h2>Youtube AI Summary</h2><button id="close" aria-label="Close summary panel">Close</button></header>
      <p id="video"></p>
      <small>On click, captions and video details are sent to seem-box.waseemkn96.workers.dev and its configured AI provider. YouTube cookies stay in your browser.</small>
      <p id="status" role="status" aria-live="polite">Ready to read this video's captions.</p>
      <button id="summarize" aria-busy="false">${spark}<span id="summarize-label">Summarize Video</span></button>
      <details><summary>Paste a transcript instead</summary>
        <label for="transcript">Transcript text</label>
        <textarea id="transcript" maxlength="500000" placeholder="Paste captions or transcript text"></textarea>
        <button id="paste">Summarize Pasted Text</button>
      </details>
      <div id="result"></div>
    </section>
    <button id="toggle" aria-label="Open AI summary" aria-expanded="false" aria-controls="panel"><span class="spark-tile">${spark}</span><span class="toggle-label">Summarize</span><span class="ai-badge" aria-hidden="true">AI</span></button>`;
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
    $("summarize").setAttribute("aria-busy", "false");
    $("summarize-label").textContent = "Summarize Video";
  }
  function setOpen(open) {
    $("panel").hidden = !open;
    $("toggle").setAttribute("aria-expanded", String(open));
    $("toggle").setAttribute("aria-label", open ? "Close AI summary" : "Open AI summary");
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
    $("summarize").setAttribute("aria-busy", "true");
    $("summarize-label").textContent = pasted ? "Preparing transcript..." : "Reading captions...";
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
      $("summarize-label").textContent = "Creating your summary...";
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
      if (isCurrent()) {
        $("summarize").disabled = $("paste").disabled = false;
        $("summarize").setAttribute("aria-busy", "false");
        $("summarize-label").textContent = "Summarize Video";
      }
    }
  }
  $("summarize").addEventListener("click", () => run(false));
  $("paste").addEventListener("click", () => run(true));
  document.addEventListener("yt-navigate-finish", updateVideo);
  window.addEventListener("popstate", updateVideo);
  updateVideo();
})();

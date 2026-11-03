// Runs in the isolated content-script world; opening a panel never sends a summary.
globalThis.seemBoxOpenTranscript = async function (videoId, signal) {
  let clicked = false;
  // YouTube mounts the description and transcript asynchronously after navigation.
  for (let attempt = 0; attempt < 30; attempt++) {
    const url = new URL(location.href);
    if (signal.aborted || url.pathname !== "/watch" || url.searchParams.get("v") !== videoId) return false;
    const watch = document.querySelector("ytd-watch-flexy");
    // Do not click controls left over from the previous video during SPA navigation.
    if (watch?.getAttribute("video-id") === videoId) {
      // Match both legacy panels and modern panels that have no target-id.
      const panel = watch.querySelector('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]:is([target-id="engagement-panel-searchable-transcript"], [target-id="PAmodern_transcript_view"], :has(transcript-segment-view-model))');
      if (panel && [...panel.querySelectorAll("ytd-transcript-segment-renderer .segment-text, transcript-segment-view-model > span.ytAttributedStringHost")].some((node) => node.textContent?.trim())) return true;
      if (!panel && !clicked) {
        // Scope to YouTube's transcript section, independent of the UI language.
        const button = watch.querySelector("ytd-video-description-transcript-section-renderer button");
        if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
          button.click();
          clicked = true;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
};

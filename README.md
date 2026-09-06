# seem_box

A personal Next.js toolbox. The first tool accepts a YouTube URL, retrieves the available captions, and returns a structured summary, key takeaways, and a conclusion.

## Requirements

- Node.js 20.9 or newer
- npm
- A ChatGPT Plus/Pro subscription, or a local OpenAI-compatible sidecar

## Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Configure the LLM from the Settings page before summarizing a video.

When ChatGPT is connected, the YouTube Summary form loads the models enabled for that account and lets you choose one per request.

## ChatGPT Subscription

Set the provider in `.env.local`:

```bash
SEEM_BOX_LLM_PROVIDER=codex
SEEM_BOX_CODEX_MODEL=gpt-5.4
```

Open Settings and select **Connect via device code**. The app uses OpenAI's Codex device authorization flow and stores the resulting OAuth tokens in `~/.seem_box/auth.json` with mode `0600`. Access tokens refresh automatically.

The default model can change as ChatGPT's model catalog changes. Override `SEEM_BOX_CODEX_MODEL` if the backend rejects the default model.

## Local Sidecar

The compatible provider calls an OpenAI-style `POST /v1/chat/completions` endpoint. It can connect to services such as ChatGPT-to-API or g4f:

```bash
SEEM_BOX_LLM_PROVIDER=compat
SEEM_BOX_COMPAT_BASE_URL=http://127.0.0.1:8080
SEEM_BOX_COMPAT_MODEL=gpt-4o-mini
SEEM_BOX_COMPAT_API_KEY=
```

Run the sidecar separately before submitting a YouTube link. Browser-session and reverse-engineered providers are unofficial, can break without notice, and may conflict with the provider's terms. Do not expose their credentials or this app to untrusted users.

## Captions

Caption retrieval uses `youtubei.js` first and `youtube-transcript` as a fallback. Videos without captions, private videos, and some restricted videos cannot be summarized.

Long transcripts are summarized in chunks before the final structured result is generated.

## Chrome Extension (Preview)

The unpacked Manifest V3 extension in `extension/` adds a **Summarize** button at the bottom-right of YouTube watch pages. It reads captions in your browser session, then sends transcript text and video metadata to `https://seem-box.waseemkn96.workers.dev`. It does not send YouTube cookies to the app, download videos, or transcribe audio.

1. Generate a random pairing token: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Configure `SEEM_BOX_EXTENSION_TOKEN` as a secret on the deployed server and configure its AI provider at `https://seem-box.waseemkn96.workers.dev/settings`. Setting it only in local `.env.local` does not configure the deployed server.
3. In Chrome 120 or newer, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder.
4. Open the extension's toolbar popup and enter the same pairing token. This is a separate app credential, not a provider API key or YouTube cookie.
5. Reload an existing YouTube tab, open a video such as `https://www.youtube.com/watch?v=pqlWNihgdjI`, and click the page's **Summarize** button. Open the panel and click **Summarize Video** to start retrieval.

The extension prefers English manual captions, then English auto-generated captions, then the first available language. If YouTube blocks the caption request, open YouTube's **Show transcript** panel and retry. You can also expand **Paste a transcript instead** in the extension panel. Summaries appear in the panel with key takeaways and a conclusion; navigating to another video clears the old result.

Permissions are limited to storage, script execution, `www.youtube.com`, and `seem-box.waseemkn96.workers.dev`. The pairing token is kept in extension-only local storage, not sync storage or the YouTube page. Captions are processed only on click and go to the deployed app and its configured AI provider. Treat the pairing token as a secret; rotate it in both places if exposed. Protect the personal app's other endpoints before public exposure; the extension token protects only the extension-summary endpoint.

This is a prototype, not a published Chrome Web Store extension. YouTube player APIs, transcript DOM selectors, and caption URLs are unofficial and may change. Browser-side retrieval can still be blocked and has not been verified against a signed-in Chrome session here. Shorts, live caption streaming, language selection, and changing the server through the settings UI are not supported in this version. Closing/reloading the tab discards the UI request; backend work already started may continue. After extension code or permissions change, reload it in `chrome://extensions`, approve any permission prompts, and reload YouTube.

The new `POST /api/extension-summary` endpoint requires the pairing token, validates and bounds the submitted text, and reuses the configured summarizer. Accepted requests stream JSON whitespace while the model works to keep the connection active; provider failures after streaming begins use an `{ "error": "..." }` body with HTTP 200. Authentication and validation failures use normal HTTP error statuses.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
node --test scripts/extension-check.mjs
NODE_OPTIONS=--conditions=react-server npx tsx scripts/extension-summary-check.ts
npx tsx scripts/transcript-check.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

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

Open Settings and select **Connect via device code**. The app uses OpenAI's Codex device authorization flow. Local Node development stores OAuth tokens in `~/.seem_box/auth.json` with mode `0600`. On Cloudflare, pending logins and tokens are stored in the `SEEM_BOX_AUTH` Durable Object instead. Access tokens refresh automatically.

The default model can change as ChatGPT's model catalog changes. Override `SEEM_BOX_CODEX_MODEL` if the backend rejects the default model.

## Cloudflare Deployment

Cloudflare deploys a **standalone, framework-free Worker**, not the Next.js toolbox. The entry point is `worker.js`, configured by `wrangler.jsonc`, for the existing Worker named `seem-box`. Its bundle contains no Next.js, React, OpenNext, Node filesystem access, or YouTube scraping libraries. The existing Next.js toolbox remains available locally with `npm run dev`.

Cloudflare scripts explicitly pass `--config wrangler.jsonc` to avoid Wrangler's framework auto-detection. Do not restore `open-next.config.ts`: alongside the local toolbox's `next.config.ts`, it can cause a plain `wrangler deploy` to delegate to OpenNext. Dry-run builds skip this delegation, so a successful dry run alone does not detect that configuration conflict.

The deployed request path is deliberately small:

```text
YouTube captions in the browser
  -> Extension sends transcript text
  -> Worker authenticates and validates the request
  -> GPT request (using the configured model directly)
  -> Structured summary returned to the extension
```

The usual short-transcript path makes one GPT generation request, plus a token read from the Durable Object when using ChatGPT. Expired credentials require a refresh. Long transcripts still use bounded chunk summaries before the final combined summary. No model-catalog lookup or YouTube request is made by the Worker.

`/settings` serves a small static HTML/JavaScript device-login interface instead of server-rendered React. `/api/extension-summary` keeps the existing extension contract. `/api/youtube-summary` returns HTTP 410 with instructions to use browser-side captions; server-side URL scraping remains a local-toolbox feature only. The root and former `/youtube-summary` page show the new setup page. Do not change the Worker entry point back to `.open-next/worker.js`.

For the connected GitHub repository, configure the Worker's **Settings > Build** commands:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:cloudflare` |
| Deploy command | `npm run deploy:cloudflare` |
| Root directory | The directory containing this project's `package.json` |

Under the Worker's **Settings > Variables and Secrets**, add these as encrypted runtime secrets, not just build environment variables:

| Secret | Purpose |
| --- | --- |
| `SEEM_BOX_ADMIN_PASSWORD` | A random password of at least 32 characters for the browser's admin login. Username: `admin`. |
| `SEEM_BOX_EXTENSION_TOKEN` | The pairing token already saved in the Chrome extension. |

Use different values for the two secrets. Generate a new random value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Do not commit either secret. Local `.env.local` values and your local ChatGPT login do not automatically populate the deployed app.

After these repository changes reach the connected deployment branch, Cloudflare's build bundles the standalone Worker and deployment applies the SQLite-backed `AuthObject` migration. No database ID needs to be created or pasted: the `SEEM_BOX_AUTH` binding and `v1` migration are declared in `wrangler.jsonc`. The lightweight deployment preserves the existing Worker name, object class, binding, named object (`owner`), and stored keys, so already-saved logins remain available. Do not recreate or rename the namespace. Preview deployments should use a separate Worker/storage namespace if they must not share production credentials.

Open `https://seem-box.waseemkn96.workers.dev/settings`, sign in to the browser prompt as `admin`, and complete a **new** device-code login. Approval is followed by token exchange and a durable save before the UI reports success. Pending flows expire after 15 minutes; successful polls are repeatable until expiry. Refreshes are serialized to avoid competing requests rotating the same refresh token.

The Worker fails closed with HTTP 503 until the admin secret is configured. The extension's exact `POST /api/extension-summary` route is exempt from the browser password prompt because it checks its own Bearer token. All other routes, including the setup page and its JavaScript, require the admin password. This remains a single-owner app, not multi-user account storage.

The Worker accesses the Durable Object directly and never falls back to filesystem storage. `SEEM_BOX_AUTH_STORAGE` is no longer needed for this entry point. Plain `npm run dev` retains local file-based auth. To preview Cloudflare locally, put synthetic test secrets in ignored `.dev.vars`, then run `npm run preview:cloudflare`. Wrangler bundles directly; no Next.js build is required. The preview uses local Durable Object storage, not production storage.

The configured GPT model is `SEEM_BOX_CODEX_MODEL` (default `gpt-5.4`). For an OpenAI-compatible API instead, set `SEEM_BOX_LLM_PROVIDER=compat`, `SEEM_BOX_COMPAT_BASE_URL` to a remote HTTPS origin (the Worker appends `/v1/chat/completions`), `SEEM_BOX_COMPAT_MODEL`, and the `SEEM_BOX_COMPAT_API_KEY` secret as needed. Requests do not follow provider redirects. There is no automatic paid-provider fallback.

The Worker bundle is approximately 49 KiB rather than the previous ~6 MiB Next.js deployment. This removes the major unnecessary CPU work, but bundle size is not a CPU benchmark: Workers Free still allows only 10 ms of CPU per request. Validate real invocation CPU usage in Cloudflare Logs, especially for large transcripts. Tests using local workerd do not enforce the production free-plan CPU quota. Network wait time is not CPU time. ChatGPT 403/account or browser-challenge restrictions are independent and are not bypassed by this redesign.

Auth persistence is verified with synthetic OAuth responses, including real workerd restart tests. A real OpenAI login still needs to be completed after deployment; upstream authorization, subscription, or bot-blocking failures are separate from storage.

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

The unpacked Manifest V3 extension in `extension/` adds a **Summarize** button at the bottom-right of YouTube watch pages. It reads captions in your browser session, then sends transcript text and video metadata to the configured server (default: `http://localhost:3000`). It does not send YouTube cookies to the app, download videos, or transcribe audio.

1. Generate a random pairing token: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Set `SEEM_BOX_EXTENSION_TOKEN` in `.env.local`, start (or restart) the local server with `npm run dev`, and configure its AI provider at `http://localhost:3000/settings`.
3. In Chrome 120 or newer, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder.
4. Open the extension's toolbar popup and enter the same pairing token. This is a separate app credential, not a provider API key or YouTube cookie.
5. Reload an existing YouTube tab, open a video such as `https://www.youtube.com/watch?v=pqlWNihgdjI`, and click the page's **Summarize** button. Open the panel and click **Summarize Video** to start retrieval.

On opening or switching to a standard YouTube video, the extension tries to open YouTube's **Show transcript** panel automatically. It waits up to 15 seconds for the controls and transcript to load, clicks at most once per navigation, and stops pending attempts when you leave the video. Summarization starts only when you click **Summarize Video**. If caption retrieval fails while the panel is loading, the extension waits for that attempt and retries retrieval once if transcript text becomes available.

The extension prefers captions in the selected language (manual, then auto-generated), falling back to English captions and then the first available language; the summary itself is always written in the selected language. If automatic opening or caption retrieval fails, the extension expands a help section: expand the video's description, click **Show transcript**, wait for text to appear, leave the panel open, and retry **Summarize Video**. You can also expand **Paste a transcript instead** in the extension panel. Automatic opening depends on YouTube exposing its transcript controls; it cannot create a transcript for a video without one. Summaries appear in the panel with key takeaways and a conclusion; navigating to another video clears the old result.

The extension interface itself is available in English and Arabic with right-to-left text layout; the launcher stays pinned to the bottom-right. It follows the browser UI language automatically; switch manually from the language dropdown in the toolbar popup or the **EN/ع** button in the panel header. The same choice also sets the summary language, and re-summarizes an existing result when switched. The choice is stored with the extension settings.

Permissions are limited to storage, script execution, `www.youtube.com`, and the configured server host (default: `localhost`). The pairing token is kept in extension-only local storage, not sync storage or the YouTube page. Opening a video may load its transcript within YouTube; transcript text and video details are sent to the configured app and its AI provider only when you click to summarize. Treat the pairing token as a secret; rotate it in both places if exposed. The extension token protects only the extension-summary endpoint.

This is a prototype, not a published Chrome Web Store extension. YouTube player APIs, transcript DOM selectors, and caption URLs are unofficial and may change. Browser-side retrieval can still be blocked and has not been verified against a signed-in Chrome session here. Shorts, live caption streaming, and changing the server through the settings UI are not supported in this version. Closing/reloading the tab discards the UI request; backend work already started may continue. After extension code or permissions change, reload it in `chrome://extensions`, approve any permission prompts, and reload YouTube.

The new `POST /api/extension-summary` endpoint requires the pairing token, validates and bounds the submitted text, and reuses the configured summarizer. Accepted requests stream JSON whitespace while the model works to keep the connection active; provider failures after streaming begins use an `{ "error": "..." }` body with HTTP 200. Authentication and validation failures use normal HTTP error statuses.

The floating launcher is icon-only until hovered or keyboard-focused. In fullscreen it sits above YouTube's playback controls and fades out after 3 seconds of inactivity. Pointer movement, a pointer press, or a key press reveals it again. It stays visible while the summary panel is open, while hovered, or while keyboard-focused; leaving fullscreen restores normal positioning and visibility.

### Configuring the extension server

Set the public server origin in `.env.local`:

```dotenv
SEEM_BOX_EXTENSION_URL=http://localhost:3000
```

Run `npm run extension:configure`, reload the extension at `chrome://extensions`, and refresh YouTube. You can also override it for one invocation:

```bash
SEEM_BOX_EXTENSION_URL=https://your-server.example npm run extension:configure
```

The command reads `.env` then `.env.local`; shell environment variables take precedence. If unset, the URL defaults to `http://localhost:3000`. Use an HTTP(S) origin with an optional port, without a path, query, or credentials. Chrome cannot read environment variables directly: this command writes the public URL to `extension/config.js` and updates `extension/manifest.json` host permissions. API requests, settings links, and UI labels use the same generated value. Tokens and other environment variables are not copied into the extension. Chrome host permissions cover all ports on the configured host; requests use the exact configured port. For a remote server, configure its AI provider and pairing token on that server.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
node --test scripts/extension-check.mjs scripts/extension-transcript-check.mjs scripts/extension-config-check.mjs scripts/extension-fullscreen-check.mjs
NODE_OPTIONS=--conditions=react-server npx tsx scripts/extension-summary-check.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/auth-storage-check.ts
node scripts/auth-worker-check.mjs
node --test scripts/admin-auth-check.mjs
npx tsx scripts/worker-summary-check.ts
npx tsx scripts/extension-handler-check.ts
node scripts/standalone-worker-check.mjs
npm run build:cloudflare
npx wrangler deploy --dry-run
node scripts/cloudflare-app-check.mjs
npx tsx scripts/transcript-check.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

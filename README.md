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

Cloudflare deploys a **standalone, framework-free Worker**, not the Next.js toolbox. The entry point is `worker.js`, configured by `wrangler.jsonc`, for the existing Worker named `seem-box`. Its bundle contains no Next.js, React, OpenNext, Node filesystem access, or YouTube scraping libraries. The existing Next.js toolbox remains available locally with `npm run dev`; its optional OpenNext integration is not used by this deployment.

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

The unpacked Manifest V3 extension in `extension/` adds a **Summarize** button at the bottom-right of YouTube watch pages. It reads captions in your browser session, then sends transcript text and video metadata to `https://seem-box.waseemkn96.workers.dev`. It does not send YouTube cookies to the app, download videos, or transcribe audio.

1. Generate a random pairing token: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Configure `SEEM_BOX_EXTENSION_TOKEN` as a secret on the deployed server and configure its AI provider at `https://seem-box.waseemkn96.workers.dev/settings`. Setting it only in local `.env.local` does not configure the deployed server.
3. In Chrome 120 or newer, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `extension` folder.
4. Open the extension's toolbar popup and enter the same pairing token. This is a separate app credential, not a provider API key or YouTube cookie.
5. Reload an existing YouTube tab, open a video such as `https://www.youtube.com/watch?v=pqlWNihgdjI`, and click the page's **Summarize** button. Open the panel and click **Summarize Video** to start retrieval.

The extension prefers English manual captions, then English auto-generated captions, then the first available language. If YouTube blocks the caption request, open YouTube's **Show transcript** panel and retry. You can also expand **Paste a transcript instead** in the extension panel. Summaries appear in the panel with key takeaways and a conclusion; navigating to another video clears the old result.

Permissions are limited to storage, script execution, `www.youtube.com`, and `seem-box.waseemkn96.workers.dev`. The pairing token is kept in extension-only local storage, not sync storage or the YouTube page. Captions are processed only on click and go to the deployed app and its configured AI provider. Treat the pairing token as a secret; rotate it in both places if exposed. The extension token protects only the extension-summary endpoint; the deployed Worker's separate admin password protects the personal app's other dynamic endpoints.

This is a prototype, not a published Chrome Web Store extension. YouTube player APIs, transcript DOM selectors, and caption URLs are unofficial and may change. Browser-side retrieval can still be blocked and has not been verified against a signed-in Chrome session here. Shorts, live caption streaming, language selection, and changing the server through the settings UI are not supported in this version. Closing/reloading the tab discards the UI request; backend work already started may continue. After extension code or permissions change, reload it in `chrome://extensions`, approve any permission prompts, and reload YouTube.

The new `POST /api/extension-summary` endpoint requires the pairing token, validates and bounds the submitted text, and reuses the configured summarizer. Accepted requests stream JSON whitespace while the model works to keep the connection active; provider failures after streaming begins use an `{ "error": "..." }` body with HTTP 200. Authentication and validation failures use normal HTTP error statuses.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
node --test scripts/extension-check.mjs
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

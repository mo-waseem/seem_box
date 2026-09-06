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

## Checks

```bash
npm run typecheck
npm run lint
npm run build
npx tsx scripts/transcript-check.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

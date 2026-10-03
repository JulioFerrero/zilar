---
id: T-0170
title: Voice transcripts on demand (owner-configured, OpenAI-compatible endpoint)
status: planned
milestone: M5
branch: task/T-0170-voice-transcripts
model: meta/muse-spark-1.3-contributor
effort: high
depends_on: [T-0162]
estimate: 1.5 days
---

# T-0170: Voice transcripts on demand

## Spec (written by Claude, do not edit)

### Why
`VoiceMessage` already renders a transcript (the "Aa" toggle shows `voice.transcript.text`) but nothing ever produces one. Julio wants "Show transcript" under voice messages: useful in meetings, for accessibility and to read a voice note without playing it. Decisions taken by the lead (change any by telling the lead): transcription is **off by default** and **configured by the server owner**, no audio leaves the server unless the owner turns it on; the service is any **OpenAI-compatible** `POST {base}/audio/transcriptions` endpoint (OpenAI, Groq, or a self-hosted Whisper server), so cost and privacy stay the owner's choice; transcripts are produced **on demand** when someone taps "Show transcript", then cached so each voice message is transcribed once. Automatic transcription for AIs and search indexing are later tasks.

### What to build

**1. Owner settings (reuse the integrations pattern from T-0162).**
- A "Voice transcription" card on the Integrations page (owner only, same 404 for everyone else): base URL (https required unless the host is `localhost`/a private address the owner typed on purpose, validated as a URL with zod), API key (optional, for self-hosted servers without one), model name (default `whisper-1`). Saved encrypted in `instance_settings` exactly like the Telegram token; the key is never returned, only `configured` and the non-secret fields (base URL and model).
- `PUT /api/settings/integrations/voice-transcription` and `DELETE` (same limiter style as the other integration writes). The PUT verifies the endpoint before storing: one tiny test request is not possible without audio, so verify with a 1-second generated silent WAV (a few KB, built in memory) sent to the endpoint; failure answers 422 `endpoint_unreachable`/`endpoint_rejected` with fixed messages and stores nothing.
- `GET /api/settings/integrations` (owner) gains `voiceTranscription: { configured, baseUrl, model }`.

**2. Transcript API (session required).**
- `GET /api/voice/transcription` returns `{ enabled: boolean }` for any signed-in user (so the web knows whether to show the control).
- `POST /api/voice/transcript` body `{ url }` returns `{ text }`. The `url` must be an upload URL on this install (same origin as `PUBLIC_URL`, path under `/upload/`); anything else is 400 (no server-side request to arbitrary hosts). The server fetches the audio from ejabberd internally (`EJABBERD_API_URL` base, same path), enforcing a 10 MB cap and a 20 s timeout, sends it to the configured endpoint, and caches the result in a new table `voice_transcripts(url_hash text primary key, text text not null, language text, created_at)` keyed by SHA-256 of the URL (one row per voice message; a concurrent duplicate request must not double-bill: take an advisory lock on the hash, re-check the cache inside it).
- Errors: 501 `transcription_not_configured`, 413 `voice_too_large`, 422 `not_audio`, 429 `rate_limited` (10 per 10 minutes per user), 502 `transcription_failed` (fixed message; never forward the provider's body).
- Audit entries carry ids only (the URL hash, never the URL or the text). The transcript text is never logged.

**3. Web.**
- `VoiceMessage`: when `GET /api/voice/transcription` says enabled (fetched once per session and shared, like the owner check), show a "Show transcript" control on every voice message that has an upload URL (replace the placeholder that only appears when a transcript already exists). Tap: loading state, then the text; error: a short message with Retry; remembered in memory for the session so toggling does not refetch. Not enabled: show nothing at all.
- Integrations page: the new card, with the same save/remove/error patterns as the Telegram and Email cards.
- Tests (Vitest, Testing Library) for the card, the control states and the API client.

**4. Docs.** One paragraph in `docs/INSTALL_DOCKER.md`: what the feature does, that audio goes to the endpoint the owner configures, and examples for OpenAI and a self-hosted Whisper server.

### Read first
`AGENTS.md` (whole security checklist), `work/T-0162-integrations-settings-telegram.md` (Report and Review), `apps/server/src/integrations/`, `apps/server/src/setup/crypto.ts`, `apps/server/src/voice/`, `apps/server/src/db/schema.ts` (instance_settings), `apps/server/src/rate-limit.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/web/src/components/VoiceMessage.tsx`, `apps/web/src/routes/IntegrationsPage.tsx`, `apps/web/src/lib/useIsServerOwner.ts`, `apps/web/src/lib/api.ts`.

### Allowed files
`apps/server/src/voice-transcription/**` (new), `apps/server/src/integrations/**`, `apps/server/src/db/schema.ts` and exactly one new migration (+ journal and snapshot), `apps/server/src/app.ts`, `apps/server/src/authz-sweep.test.ts`, `apps/web/src/components/VoiceMessage.tsx` and its tests, `apps/web/src/routes/IntegrationsPage.tsx` and tests, `apps/web/src/lib/api.ts` and its test, `apps/web/src/mock/**` (only for the new endpoints), `docs/INSTALL_DOCKER.md`, `work/T-0170-voice-transcripts.md`. No new dependencies (use the built-in `fetch` and `FormData`).

### Checks
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/server test --maxWorkers=2 src/voice-transcription src/integrations src/voice src/authz-sweep.test.ts
pnpm --filter @zilar/web test --maxWorkers=2 src/components/VoiceMessage src/routes/IntegrationsPage src/lib/api.test.ts
```
Tests must use a fake provider (a local test server or an injected fetch), never a real endpoint or key.

### Acceptance
- With nothing configured, no control appears and `POST /api/voice/transcript` answers 501.
- The owner configures an endpoint (verified with the silent WAV, nothing stored on failure); then "Show transcript" on a voice message returns the text, a second tap or another user gets the cached text with no second provider call (test counts provider calls, including two requests at once).
- A URL outside this install's upload path is refused before any request is made; an oversized file is refused; the provider's error body, the API key, the URL and the text appear in no log, audit entry or error response.
- Every new route is in the 401 sweep and rate limited; non-owners get the same 404 on the settings routes.

### Out of scope
Automatic transcription for every voice message, AIs reading transcripts, transcript search, languages beyond what the provider detects, mobile, running Whisper inside Zilar.

---

## Report (written by the worker when done)

## Review (written by Claude)

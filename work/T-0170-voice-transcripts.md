---
id: T-0170
title: Voice transcripts on demand (owner-configured, OpenAI-compatible endpoint)
status: review
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

Done. Voice transcripts on demand: the owner configures an OpenAI-compatible
endpoint (verified with a silent WAV before storing), and any signed-in user
gets a "Show transcript" control under voice messages while it is enabled.
Each voice message is transcribed once and cached; a concurrent duplicate
request causes a single provider call.

**Server** (`apps/server/src/`):
- `voice-transcription/settings.ts` (new): `voice_transcription.base_url`
  (clear) + `voice_transcription.api_key` (encrypted with the T-0161 cipher)
  + `voice_transcription.model` (clear, default `whisper-1`) in
  `instance_settings`; get/save/delete helpers. No env override:
  transcription is off by default, only a stored owner-verified endpoint
  turns it on.
- `voice-transcription/provider.ts` (new): the OpenAI-compatible port.
  `POST {base}/audio/transcriptions` with multipart `file` + `model` and an
  optional bearer key, 60 s timeout, zod-validated `{ text, language }`
  (empty text is valid — silence has no words, and the verify call must not
  brick real endpoints). Every failure maps to `TranscriptionProviderError`;
  the provider's body is never forwarded. `silentVerificationWav()` builds
  the 1-second 16 kHz mono silent WAV in memory. `fetchFn` injected.
- `voice-transcription/routes.ts` (new):
  `GET /api/voice/transcription` → `{ enabled }` (any session);
  `POST /api/voice/transcript` body `{ url }` → `{ text }` (10/10min per
  user; 501 `transcription_not_configured`, 400 for a non-install URL, 413
  `voice_too_large`, 422 `not_audio`, 502 `transcription_failed` fixed
  message). The URL must share `PUBLIC_URL`'s origin with a path under
  `/upload/` (else 400 before any request); the fetch goes to
  `EJABBERD_API_URL`'s base with the same path (10 MB cap, 20 s timeout).
  Cache: `voice_transcripts(url_hash PK, text, language, created_at)` keyed
  by SHA-256 of the URL; the check-and-transcribe runs in one transaction
  under `pg_advisory_xact_lock('voice-transcript:' + hash)` with the cache
  re-checked inside, plus `onConflictDoNothing` as the backstop — a
  concurrent duplicate never double-bills. Audit
  `voice.transcript_requested` carries `detail: { urlHash }` only.
  `PUT /api/settings/integrations/voice-transcription`
  `{ baseUrl, apiKey?, model? }` (owner-only 404 like the others, 10/10min):
  zod + https-except-localhost/private-literal validation (uses the
  `sandbox/ip-guard` classifier; hostnames resolve nothing server-side —
  DNS rebinding for a stored base URL is the owner's explicit choice),
  then verify-through-the-real-path with the silent WAV: provider-shaped
  failure → 422 `endpoint_rejected`, anything else (network/abort) → 422
  `endpoint_unreachable`, both store nothing. `DELETE` removes all three
  keys (no rate limit consumed, like Telegram's remove). Audits
  `integrations.voice_transcription_set/removed`, detail null.
- `db/schema.ts` + `drizzle/0038_voice-transcripts.sql` (+ journal and
  snapshot): the `voice_transcripts` table, exactly one migration.
- `integrations/routes.ts`: `GET /api/settings/integrations` gains
  `voiceTranscription: { configured, baseUrl, model }` (key never returned).
- `app.ts`: mounts the new routes with a `voiceTranscription` test seam
  (`transcriptLimiter`, `settingsLimiter`, `now`, `audioFetcher`,
  `transcribe`).
- Tests: `provider.test.ts` (5: endpoint builder, WAV header bytes, multipart
  + bearer on/off, rejection/malformed/network mapping) and
  `routes.test.ts` (21: enabled flag off/on, 501, transcribe-once + cached
  for second tap and another user, concurrent pair → 1 provider call,
  foreign-URL refusal before any fetch, oversized 413, non-audio 422,
  provider 502 + nothing cached, per-user rate limit, sentinel key/URL/text
  absent from logs/audit/errors, owner PUT/DELETE + 404 for non-owner,
  https rule (public http/ftp/garbage 400; localhost/127.0.0.1/192.168.x
  200), rejected vs unreachable 422 + nothing stored, bad bodies never call
  the endpoint, remove clears + DELETE skips the budget). Fake audio fetcher
  and fake transcriber with a call counter throughout — no real endpoint.
- T-0162 suites updated: `integrations/routes.test.ts` empty-state shape
  gains the new field (1 line).

**Web** (`apps/web/src/`):
- `lib/api.ts`: `getVoiceTranscriptionStatus`, `getVoiceTranscript(url)`,
  `saveVoiceTranscriptionSettings` (omits unset key/model),
  `removeVoiceTranscriptionSettings`; `integrationsStatusSchema` gains
  optional `voiceTranscription` (optional so older servers still parse —
  the card falls back to empty). Tests: 3 new (`api.test.ts`).
- `lib/useVoiceTranscription.ts` (new) + test (2): `{ enabled }` fetched
  once per session, cached in module state, starts disabled — the
  `useIsServerOwner` pattern.
- `components/VoiceMessage.tsx`: when enabled, every voice message with an
  upload URL gets the "Show transcript" control (replacing the placeholder
  that only appeared for embedded transcripts); tap → "Transcribing…" then
  the text; error → short message + Retry; session `Map<url, text>` so
  toggling or remounting never refetches; embedded transcripts (if any)
  still show without a fetch. Not enabled: nothing at all. Tests (5 new in
  `VoiceMessage.test.tsx`: hidden-when-disabled, fetch-once + session
  memory incl. remount, error + Retry refetches, POST body shape).
- `routes/IntegrationsPage.tsx`: new "Voice transcription" card below
  Telegram (status, OpenAI/Groq/self-hosted hint, base URL + model + optional
  key, "Checking…" save, Remove, `endpoint_unreachable`/`endpoint_rejected`
  errors, "Saved" only after the reload proves it). Tests: order is now
  Email/Telegram/Voice, save body incl. key+model, 422 message, remove flow.
- `mock/api.ts`: mock-mode answers `GET /voice/transcription`
  (`{ enabled: true }`) and `POST /voice/transcript` (fixed sentence per
  URL) so the control is exercisable without a server.

**Docs:** `docs/INSTALL_DOCKER.md`: "Optional: voice message transcripts"
paragraph (off by default, audio goes only to the configured endpoint,
OpenAI/Groq/self-hosted examples, silent-verification note).

**Commands (real results):**
- `pnpm install`: exit 0.
- `pnpm format:check`: pass (after prettier on my files; the two generated
  drizzle meta files needed one prettier pass too — content unchanged).
- `pnpm lint`: pass.
- `pnpm typecheck`: 11 tasks pass (fixed 3 `as` casts in provider.test.ts
  via `as unknown as`).
- `pnpm --filter @zilar/server test --maxWorkers=2
  src/voice-transcription src/integrations src/voice
  src/authz-sweep.test.ts`: 5 files passed, 2 skipped (integration), 58
  passed / 3 skipped. The sweep prints all 4 new routes → 401
  unauthenticated.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/components/VoiceMessage
  src/routes/IntegrationsPage src/lib/api.test.ts
  src/lib/useVoiceTranscription.test.tsx src/lib/useIsServerOwner.test.tsx`:
  6 files, 114 passed.
- Neighbours: web player/composer voice suites + mock suite pass (18 + 12);
  server voice engine/routes pass.

**Security checklist:** key encrypted at rest, never in GET/audit/errors/
responses/logs (sentinel tests for key, URL, text; audit rows detail-null
or `{ urlHash }`; request log sees paths only); settings rows are global
singleton keys, owner-gated; single-flight via advisory xact lock +
in-tx re-check + unique PK (check-then-insert never escapes the lock);
429/42x before any provider call and before storing; unknown vs forbidden
both 404 on all settings routes; new routes session-required (sweep: 401,
never allowlisted); transcript POST + settings PUT rate-limited 10/10min
per user, DELETE consumes nothing; audit carries the URL hash only, never
URL or text.

**Deviations / notes:** (1) `logger.ts` untouched (outside Allowed files):
`resendApiKey`/`botToken` redaction already covers the new `apiKey` body
field via the generic `apiKey` path — worth a lead check. (2) No `not_audio`
probe of real bytes: the content-type gate treats `audio/*`, `video/mp4`
(XEP-0363 voice notes are M4A) and `application/octet-stream` as audio;
anything else (e.g. ejabberd's 404 HTML) is 422 without billing the owner.
(3) `endpoint_unreachable` vs `endpoint_rejected` split by error shape:
provider-shaped (HTTP/non-2xx/bad JSON via the seam) → rejected, transport
throw → unreachable.

## Review (written by Claude)

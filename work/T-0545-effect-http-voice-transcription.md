---
id: T-0545
title: "Effect C (HTTP): voice transcription routes (status, transcript, owner settings PUT/DELETE) onto the HttpApi adapter, zod to Effect Schema; decode before limiter kept; helpers stay in routes.ts; tests unchanged"
status: todo
milestone: M5
branch: task/T-0545-effect-http-voice-transcription
model: auto
effort: low
depends_on: [T-0536]
estimate: 1 day
---

# T-0545: voice transcription routes on Effect HTTP

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: Effect's HTTP server replaces Hono, and Effect Schema replaces zod. **The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server route module onto Effect HTTP"** (read items 8-10 too). The worked example is `apps/server/src/groups/api.ts`. The pipeline (`voice-transcription/pipeline.ts`) is already on Effect; **do not touch it.** The owner settings carry the provider API key, which never appears in a response, log line or error text, the same as today.

### Verified facts (do not re-derive; read each route for its exact step order, statuses, bodies, audit calls and texts)
- **`apps/server/src/voice-transcription/routes.ts`** (486 lines):
  - constants `VOICE_TRANSCRIPT_RATE_LIMIT_MAX`, `VOICE_TRANSCRIPT_RATE_LIMIT_WINDOW_MS`, `VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_MAX` and `VOICE_TRANSCRIPT_RATE_LIMIT_OWNER_WINDOW_MS` (lines 76-79);
  - `VoiceTranscriptionRoutesDependencies` (111), with the injectable `transcriptLimiter`, `settingsLimiter`, `now`, `audioFetcher` and `transcribe`;
  - re-exports from `./pipeline` (`AudioFetcher`, `FetchedAudio`, `Transcriber`, `AudioUnavailableError`);
  - `isOwner` (non-owners get the same 404, `notFound()`);
  - `voiceTranscriptUrlHash` (150) and `createVoiceTranscriptionRoutes` (154), with two limiters (159 and 166);
  - `VoiceTranscriptionPublicStatus` (388) and `toInternalUploadUrl` (423).
- **The four routes:**
  - `GET /voice/transcription` (199) answers `{ enabled }`;
  - `POST /voice/transcript` (205). Its order: session, then settings (501 `transcription_not_configured`), then **decode before the limiter** (comment at 215: malformed requests must not burn budget), then the URL check through `toInternalUploadUrl`, then the rest;
  - `PUT /settings/integrations/voice-transcription` (283), with `voiceSettingsBodySchema`;
  - `DELETE /settings/integrations/voice-transcription` (364).
- **Outside importers that must keep working:**
  - `apps/server/src/integrations/routes.ts:52` imports `voiceTranscriptionStatusFor`;
  - `apps/server/src/files/routes.ts:15` imports `toInternalUploadUrl`;
  - `apps/server/src/voice-transcription/routes.test.ts:22-25` imports `VOICE_TRANSCRIPT_RATE_LIMIT_MAX` and `type VoiceTranscriptionRoutesDependencies` from `./routes`.
- **`apps/server/src/app.ts`** (around line 564) mounts `app.route('/api', createVoiceTranscriptionRoutes({ auth, db, config, logger, audit: auditRecorder, ...voiceTranscription }))`. Keep it at the same position.
- **Tests (all unchanged):** every `apps/server/src/voice-transcription/*.test.ts`, `apps/server/src/integrations/routes.test.ts`, `apps/server/src/files/*.test.ts`, the authz sweep (`authz-sweep`) and `app.test`.

### What to build
1. **Create `apps/server/src/voice-transcription/api.ts`** with the four routes on `HttpApi`:
   - the same statuses, bodies, audit calls, texts and **step order** (decode before the limiter on the transcript route);
   - the same owner-only 404;
   - injectable limiters, `now`, `audioFetcher` and `transcribe`;
   - Effect Schema for the two bodies, with no zod in `api.ts`;
   - success schemas listing every field (item 8).
2. **`voice-transcription/routes.ts`:** remove the Hono factory and the zod body schemas. **Keep** every other export listed above exported from it.
3. **`app.ts`:** mount with `mountEffectRoutes(...)` at the same position.
4. **Tests:** every listed test passes **unchanged**. If one cannot (for example, one that reads Hono internals), stop and report BLOCKED with the line.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the HTTP recipe), `apps/server/src/effect/http.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/voice-transcription/routes.ts` (all of it), and the voice mount in `apps/server/src/app.ts`.

### Allowed files
`apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice-transcription/routes.ts`, `apps/server/src/app.ts`, `work/T-0545-effect-http-voice-transcription.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription integrations files authz-sweep app.test
pnpm gate
```

### Acceptance
- Voice transcription is served by Effect `HttpApi`, with the same answers, step order and owner-only 404, and no key leaked.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

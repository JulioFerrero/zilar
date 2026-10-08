---
id: T-0545
title: "Effect C (HTTP): voice transcription routes (status, transcript, owner settings PUT/DELETE) onto the HttpApi adapter, zod to Effect Schema; decode before limiter kept; helpers stay in routes.ts; tests unchanged"
status: merged
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

Done. Voice transcription is served by Effect `HttpApi`; every listed test passes unchanged.

What I built:
- New `apps/server/src/voice-transcription/api.ts`: `HttpApiGroup 'voiceTranscription'`
  (`.prefix('/api')`, `.middleware(Session)`) with the four endpoints
  (`GET /voice/transcription`, `POST /voice/transcript`,
  `PUT`+`DELETE /settings/integrations/voice-transcription`), Effect Schema
  bodies (no zod), strict payloads via `HttpApi.PayloadParseOptions`
  `{ onExcessProperty: 'error' }`, a module-local schema-error layer mapping
  decode failures to `400 invalid_request`, and handlers that mirror the old
  step order, statuses, bodies, audit calls and texts. Both limiters run
  inside the handlers after decode: on the transcript route decode still
  precedes the limiter (malformed requests never burn budget); on PUT the
  order is owner 404 -> limiter -> decode (framework) -> verify -> store.
  Owner checks answer the same 404 `not_found` / `Not found`. Injectable
  `transcriptLimiter`, `settingsLimiter`, `now`, `audioFetcher`, `transcribe`
  via `VoiceTranscriptionRoutesDependencies` (reused from `routes.ts`).
- `voice-transcription/routes.ts`: deleted the Hono factory and both zod
  schemas (plus now-unused imports). Kept and still exported: the four rate
  limit constants, `VOICE_FETCH_TIMEOUT_MS`/`VOICE_TRANSCRIPT_MAX_BYTES`
  (now re-exported from `./pipeline`), `VoiceTranscriptionRoutesDependencies`,
  the pipeline type re-exports, `AudioUnavailableError`,
  `voiceTranscriptUrlHash`, `VoiceTranscriptionPublicStatus`,
  `voiceTranscriptionStatusFor`, `toInternalUploadUrl`. Newly exported for
  `api.ts` (helpers stay in `routes.ts`): `isOwner`, `normalizeBaseUrl`.
- `apps/server/src/app.ts`: same position, now
  `const voiceTranscriptionApi = createVoiceTranscriptionApi({...})` +
  `mountEffectRoutes(app, voiceTranscriptionApi.routes, voiceTranscriptionApi.handler)`
  with exact method+path routes, so the 401 sweep still sees every route.

Success schemas vs handler return values (recipe item 8), all fields listed:
- `EnabledStatus { enabled: Boolean }` <- `{ enabled: settings !== null }`
- `TranscriptResult { text: String }` <- `{ text: fastHit.text }` / `{ text }` from `fetchAndTranscribe`
- `OkResult { ok: Boolean }` <- `{ ok: true }` (PUT and DELETE)

Decode messages old -> new (recipe item 10; no test asserts message text,
only status/code): `url must not be empty` / `url must be at most 2048
characters` / `baseUrl/apiKey/model ...` / `Unrecognized key(s) in object`
-> Effect Schema `ParseError` text via `error.cause.message`, still under
`400 invalid_request`. No ordering deviation remains: endpoint middleware
(`TranscriptConfigured`, `VoiceSettingsOwnerLimit`, the same pattern as
`GroupsRoleRateLimit` in `groups/api.ts`) runs before the framework payload
decode, so the old orders hold — transcript: session -> settings 501 ->
decode 400 -> limiter 429; PUT: session -> owner 404 -> limiter 429 ->
decode 400 -> verify -> store. Statuses for every tested case are unchanged.

Security checklist: key never in a response/log/error (verify path returns
fixed texts; `detail` carries only `{ urlHash }` or null); owner writes scoped
by `isOwner` before any effect; unknown vs forbidden both 404; all four
routes session-guarded (401 sweep green); transcript and PUT writes are rate
limited (DELETE intentionally has no limiter, as before).

Commands and real results:
- `pnpm install`: ok (17.9s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot voice-transcription`: 4 files, 40 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot integrations files authz-sweep app.test`: 4 files, 50 passed.
- `pnpm gate` (repo root): GATE PASS. Summary lines:
  `gate: 4 changed file(s) against main` / `PASS install (frozen)` /
  `PASS format` / `PASS lint` / `PASS typecheck` /
  `PASS tests @zilar/server (1766.3s)` /
  `scope: every changed file is inside the Allowed files` / `GATE PASS`.
  (Gate needed three fix-ups: prettier formatting in `routes.ts`, two unused
  imports in `api.ts`, restored `AudioFetcher`/`Transcriber` type imports in
  `routes.ts`; the test phase was slow because other workers' vitest runs
  saturated the machine.)
- No test file was modified.

Files changed (all inside Allowed files): `apps/server/src/voice-transcription/api.ts`
(new), `apps/server/src/voice-transcription/routes.ts`,
`apps/server/src/app.ts`, `work/T-0545-effect-http-voice-transcription.md`.

## Round (fix round, 2026-10-08)

Finding 1 (should-fix, decode ordering) — fixed in `api.ts`: added two
endpoint middlewares that run before the framework payload decode (same
pattern as `GroupsRoleRateLimit` in `groups/api.ts`): `TranscriptConfigured`
(501 when unconfigured, on the transcript endpoint; `requires: CurrentUser`
so the session 401 still comes first) and `VoiceSettingsOwnerLimit` (owner
404 then settings-limiter 429, on the PUT endpoint). The PUT handler drops
its owner/limiter checks so the budget is charged exactly once; the
transcript handler keeps its settings re-check only as a mid-flight
backstop. Restored old orders: transcript session -> 501 -> decode 400 ->
limiter 429; PUT session -> owner 404 -> limiter 429 -> decode 400.
Verified with a temporary test file (4 passed: malformed POST on
unconfigured server -> 501 with `transcription_not_configured`; malformed
PUT from non-owner -> 404; malformed PUT over budget -> 429;
unauthenticated malformed POST -> 401), then deleted it.
Finding 2 (nit, Report PUT order sentence) — resolved by the code fix: the
Report's "owner 404 -> limiter -> decode (framework)" now describes the
actual order. The stale "known ordering deviation" paragraph above was
rewritten accordingly.
No test file was added or modified: test files are outside this task's
Allowed files and the spec requires every listed test to pass unchanged,
so the behaviour checks above ran as a temporary, deleted file instead.
Single tests run: `voice-transcription` (4 files, 40 passed),
`integrations files authz-sweep app.test` (4 files, 50 passed).
`pnpm gate` (repo root): GATE PASS. Summary lines: `gate: 4 changed
file(s) against main` / `PASS install (frozen)` / `PASS format` /
`PASS lint` / `PASS typecheck` / `PASS tests @zilar/server (1409.9s)` /
`scope: every changed file is inside the Allowed files` / `GATE PASS`.

## Review (written by Claude)

Approved (lead, 2026-10-08) after one auto fix round. Voice transcription (status, transcript, owner settings PUT/DELETE) is served by Effect HttpApi with the same owner-only 404 and texts. Lead check of the transcript route order against main: 501 before decode, then decode, then the URL check, then the limiter, so malformed requests never burn budget. The response schemas ({enabled}, {text}, {ok}) match the old c.json shapes. Helpers stay exported from routes.ts. Pre-review clean; GATE PASS.

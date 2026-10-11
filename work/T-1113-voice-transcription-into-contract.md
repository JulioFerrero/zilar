---
id: T-1113
title: "S15 (part 2): the voice-transcription group (status, transcript, settings put/delete) moves into @zilar/api-contract unchanged; web's 4 calls use callApi"
status: merged
milestone: M5
branch: task/T-1113-voice-transcription-into-contract
model: auto
effort: default
depends_on: [T-1111]
estimate: 0.2 day
---

# T-1113: Voice transcription in the shared contract

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11, S15: "move them unchanged". T-1111 moved `/xmpp/token`, and this moves the 4 voice calls the same way.

**What the lead read:**
- **The server group,** in `apps/server/src/voice-transcription/api.ts:63-87`: `VoiceTranscriptionGroup = HttpApiGroup.make('voiceTranscription')` with
  - `get('status', '/voice/transcription', { success: EnabledStatus })`;
  - `post('transcript', '/voice/transcript', { payload: TranscriptBody, success: TranscriptResult })`, with `.annotate(HttpApi.PayloadParseOptions, { onExcessProperty: 'error' })` and `.middleware(TranscriptConfigured)`;
  - `put('setSettings', '/settings/integrations/voice-transcription', { payload: VoiceSettingsBody, success: OkResult })`, with the same annotate and `.middleware(VoiceSettingsOwnerLimit)`;
  - `delete('removeSettings', …, { success: OkResult })`;
  - then `.middleware(Session)`, `.middleware(SchemaErrors)` and `.prefix('/api')`.
- **The schemas** are in `apps/server/src/voice-transcription/schemas.ts`. `EnabledStatus` and `TranscriptResult` are already re-exported from `@zilar/api-contract` (`:5`); `TranscriptBody` is at `:10-12`, `VoiceSettingsBody` at `:16-20` and `OkResult` at `:24`.
- **The tags** are in `apps/server/src/voice-transcription/middleware.ts`: `TranscriptConfigured` (`:14-17`, key `'zilar/effect/http/TranscriptConfigured'`) and `VoiceSettingsOwnerLimit` (`:48-51`, key `'zilar/effect/http/VoiceSettingsOwnerLimit'`), both `{ requires: CurrentUser }`. Their layers (`transcriptConfiguredLayer`, `voiceSettingsOwnerLimitLayer`) stay on the server.
- **The contract** already has `Session`, `CurrentUser` and `SchemaErrors` (`packages/api-contract/src/middleware.ts`), and `packages/api-contract/src/voice-transcription.ts` holds `EnabledStatus` and `TranscriptResult`.
- **Web** calls by hand: `apps/web/src/lib/api/settings.ts:69-101` (`getVoiceTranscriptionStatus`, `getVoiceTranscript`, `saveVoiceTranscriptionSettings`, `removeVoiceTranscriptionSettings`).
- **The pattern** is T-1111 (`packages/api-contract/src/xmpp.ts`, `apps/server/src/xmpp/api.ts`).

### What to build
1. **`packages/api-contract/src/voice-transcription.ts`:**
   - add `TranscriptBody`, `VoiceSettingsBody` and `OkResult`, moved byte-for-byte (the same checks and `Schema.Trim`);
   - add `VoiceTranscriptionGroup`, exactly as above: the same names, paths, annotations, middleware order and prefix.
2. **`packages/api-contract/src/middleware.ts`:** move the two tag classes there with the **same keys**.
3. **`packages/api-contract/src/api.ts`:** add `VoiceTranscriptionGroup` to `ZilarApi`.
4. **The server:**
   - `apps/server/src/voice-transcription/schemas.ts` re-exports the moved schemas from `@zilar/api-contract`, so the other importers keep working;
   - `middleware.ts` imports the two tags from the contract (re-export them if other files import them from here) and keeps both layer functions unchanged;
   - `api.ts` deletes its local group and imports it from the contract. Handlers, limiters, audit calls and the API-key handling are unchanged.
5. **`apps/web/src/lib/api/settings.ts`:** the 4 functions use `callApi((client) => client.voiceTranscription.<endpoint>(...))`, with the same signatures and return types.
   - `saveVoiceTranscriptionSettings` still leaves out undefined `apiKey`/`model` (optional keys are omitted, not sent as `undefined`).
   - The `removeAvatar` and `/setup` `request(` calls stay hand-written.
6. **Leave alone:** mobile (`apps/mobile/src/lib/integrations-api.ts`) and the mock backend.
7. **Proof in the Report:**
   - `grep -n "request(" apps/web/src/lib/api/settings.ts` shows only `/setup/status`, `/setup` and the avatar delete;
   - `grep -rn "TranscriptConfigured\|VoiceSettingsOwnerLimit" packages/api-contract/src apps/server/src` shows each key defined once.
8. **No new tests** (not a crucial area). Every file stays at most 400 lines.

### Read first
`AGENTS.md`, `apps/server/src/voice-transcription/{api,middleware,schemas}.ts`, `packages/api-contract/src/{voice-transcription,middleware,api,xmpp}.ts`, `apps/server/src/xmpp/api.ts`, and `apps/web/src/lib/api/settings.ts`.

### Allowed files
`packages/api-contract/src/voice-transcription.ts`, `packages/api-contract/src/middleware.ts`, `packages/api-contract/src/api.ts`, `apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice-transcription/middleware.ts`, `apps/server/src/voice-transcription/schemas.ts`, `apps/web/src/lib/api/settings.ts`, `work/T-1113-voice-transcription-into-contract.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- Both grep proofs are in the Report.

---

## Report (written by the worker when done)

### What I did
Moved the voice-transcription group into `@zilar/api-contract` unchanged, following the T-1111 pattern, and switched web's 4 calls to the derived client.

1. `packages/api-contract/src/voice-transcription.ts`: added `TranscriptBody`, `VoiceSettingsBody` and `OkResult` byte-for-byte from the server's `schemas.ts` (same checks, same `Schema.Trim`), and added `VoiceTranscriptionGroup` with the same endpoint names, paths, `PayloadParseOptions` annotations, middleware order, `Session`/`SchemaErrors` and `.prefix('/api')`.
2. `packages/api-contract/src/middleware.ts`: added the `TranscriptConfigured` and `VoiceSettingsOwnerLimit` tag classes with the **same keys** (`zilar/effect/http/TranscriptConfigured`, `zilar/effect/http/VoiceSettingsOwnerLimit`), both `{ requires: CurrentUser }`.
3. `packages/api-contract/src/api.ts`: added `VoiceTranscriptionGroup` to `ZilarApi` (import + `.add(...)`).
4. Server: `schemas.ts` now only re-exports `EnabledStatus`, `OkResult`, `TranscriptBody`, `TranscriptResult`, `VoiceSettingsBody` from the contract; `middleware.ts` imports the two tags from the contract and keeps `transcriptConfiguredLayer` / `voiceSettingsOwnerLimitLayer` unchanged (their bodies still use the imported tag classes); `api.ts` deletes its local group and imports `VoiceTranscriptionGroup` from the contract. Handlers, limiters, audit calls, API-key handling and the `mountApi` wiring are unchanged.
5. `apps/web/src/lib/api/settings.ts`: the 4 functions call `callApi((client) => client.voiceTranscription.<endpoint>(...))` with the same signatures/return types; `saveVoiceTranscriptionSettings` omits undefined `apiKey`/`model` with conditional spreads. The `removeAvatar` and `/setup` `request(` calls are untouched.
6. Left alone: mobile (`apps/mobile/src/lib/integrations-api.ts`) and the mock backend.

Unused imports removed as a consequence of deleting the local group: server `api.ts` dropped `HttpApiEndpoint`/`HttpApiGroup`, `Session`/`SchemaErrors` and the whole `./schemas` import; web `settings.ts` dropped the now-unused `EnabledStatus`/`TranscriptResult` imports. Nothing else imported the two tags from `apps/server/src/voice-transcription/middleware.ts`, so no re-export was needed there.

### Files changed
- `packages/api-contract/src/voice-transcription.ts`
- `packages/api-contract/src/middleware.ts`
- `packages/api-contract/src/api.ts`
- `apps/server/src/voice-transcription/api.ts`
- `apps/server/src/voice-transcription/middleware.ts`
- `apps/server/src/voice-transcription/schemas.ts`
- `apps/web/src/lib/api/settings.ts`
- `work/T-1113-voice-transcription-into-contract.md`

`git diff --stat`: 8 files changed, 106 insertions(+), 104 deletions(-). Every file is at most 400 lines.

### Commands run (real results)
- `pnpm install`: resolved 1262, reused 1141, added 1170; "Done in 10.2s". (A pre-existing peer-dependency warning from `apps/mobile` only.)
- Grep proof 1 — `grep -n "request(" apps/web/src/lib/api/settings.ts`:
  ```
  147:  return request('/setup/status', setupStatusSchema);
  164:  return request('/setup', setupResultSchema, {
  193:  await request(`/avatars/${kind}/${encodeURIComponent(ownerId)}`, struct({ ok: Schema.Boolean }), {
  ```
  Only `/setup/status`, `/setup` and the avatar delete remain hand-written.
- Grep proof 2 — `grep -rn "TranscriptConfigured\|VoiceSettingsOwnerLimit" packages/api-contract/src apps/server/src`: each key is defined exactly once, in `packages/api-contract/src/middleware.ts` (`:260` `'zilar/effect/http/TranscriptConfigured'`, `:269` `'zilar/effect/http/VoiceSettingsOwnerLimit'`); every other hit is an import or a usage.
- `pnpm exec prettier --write packages/api-contract/src/voice-transcription.ts`: after an initial `pnpm gate` failed on format for that one new file; Prettier collapsed the `./middleware` import to a single line. No other file needed formatting.
- `pnpm gate` (final):
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.1s)
  PASS  lint  (0.9s)
  PASS  typecheck (4.7s)
  PASS  effect (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/server (no nearby test files)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  No single test files were run while working: this change is a pure move (no crucial code touched) and the gate found no nearby test files.

### Deviations from the spec
- None. No new tests were added (spec item 8), as this is not a crucial area.
- The first gate attempt failed on `format` for the new contract file; fixed with Prettier as the gate's own hint said, then re-ran the gate.

### Open questions
- None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with 1 nit (header comment wording).**
- **The change:** `VoiceTranscriptionGroup` and `TranscriptBody`, `VoiceSettingsBody` and `OkResult` move into `packages/api-contract/src/voice-transcription.ts`. The two tags move into `middleware.ts` with the same keys, and each is now defined once (`middleware.ts:257,266`). The server keeps its layers, handlers and API-key handling, and re-exports the moved schemas.
- **Web:** the 4 calls use `client.voiceTranscription.{status,transcript,setSettings,removeSettings}`, and undefined `apiKey`/`model` are still left out. `settings.ts` keeps only `/setup/status`, `/setup` and the avatar delete as `request(`, as planned.
- **One edge checked:** the client now encodes `VoiceSettingsBody` (`Schema.Trim` plus length checks) before sending. The only caller, `VoiceTranscriptionCard.tsx:38-44`, trims every value and blocks an empty URL first, so nothing changes in practice.
- **The gate passed.** There are no voice tests (not a crucial area).

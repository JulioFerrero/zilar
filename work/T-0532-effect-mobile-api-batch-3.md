---
id: T-0532
title: "Effect lane E, batch 3: mobile media-api, groups-api, integrations-api and voice-transcripts onto Effect Schema (+ the T-0506 request pipeline for the API clients); zod leaves apps/mobile; tests unchanged"
status: merged
milestone: M5
branch: task/T-0532-effect-mobile-api-batch-3
model: auto
effort: low
depends_on: [T-0527]
estimate: 0.5 day
---

# T-0532: mobile batch 3 on Effect, and zod leaves mobile

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, and Effect Schema replaces zod. Batches 1 and 2 (T-0524, T-0527) follow the T-0506 recipe; see `docs/EFFECT_GUIDE.md`, "Moving a mobile API client onto Effect", and `apps/mobile/src/lib/pins-api.ts`. **This batch includes the only two mobile files that import zod**, so zod leaves `apps/mobile` with it.

### Verified facts (do not re-derive)
- **`apps/mobile/src/lib/media-api.ts`** (210 lines): `MediaTab`, `MediaKind`, `MediaItem`, `MediaPage`, `ListChatMediaInput`, `MediaApi`, `MediaApiError`, **`parseMediaItem(value): MediaItem | null`** (line 89) and `createMediaApi`. It validates by hand.
- **`apps/mobile/src/lib/groups-api.ts`** (240 lines): `ChannelMemberRole`, `GroupsApi`, `GroupsApiError` and `createGroupsApi`. It validates by hand.
- **`apps/mobile/src/lib/integrations-api.ts`** (227 lines) **uses zod.**
  - Its types are `z.infer` exports at lines 53-56: `TelegramIntegrationStatus`, `EmailIntegrationStatus`, `VoiceIntegrationStatus` and `IntegrationsStatus`. They must keep the same shape.
  - It also exports `SaveEmailSettingsInput`, `SaveVoiceTranscriptionInput`, `IntegrationsApi`, `IntegrationsApiError`, `buildSaveEmailBody` (line 92), `buildSaveVoiceBody` (line 99; both request builders stay) and `createIntegrationsApi`.
  - Integrations carry secrets (bot tokens, SMTP passwords) in requests. Never log a body; errors stay secret-free, as today.
- **`apps/mobile/src/lib/voice-transcripts.ts`** (188 lines) **uses zod.**
  - It exports `StoredTranscriptSchema` (a `z.object` with `text` min 1 and `language` optional), `StoredTranscript` (`z.infer`), `TranscriptMap`, the constants, `TranscriptFile`, `parseTranscripts`, `readTranscripts`, `saveTranscript` and `deleteTranscript`.
  - **`parseTranscripts` keeps the valid entries and drops only the invalid ones** (comment around line 65).
  - No other file uses `StoredTranscriptSchema` (grep checked).
- **`apps/mobile/package.json`** has `"zod": "^4.6.5"` (line 64). These two files are the only zod importers in `apps/mobile/src`.
- **Tests that cover them (all unchanged):**
  - `apps/mobile/src/lib/{media-api,groups-api,voice-transcripts}.test.ts`;
  - `apps/mobile/src/components/integrations/{integrations-api.test.ts,integrations-mock.test.ts,card-save.test.ts,errors.test.ts,integrations-screen.test.tsx}`;
  - `apps/mobile/src/components/chat/{new-channel-sheet,visibility-fields}.test.tsx`;
  - `apps/mobile/src/store/real-store.{channels,groups-create,media}.test.ts`.

### What to build
1. **Convert the three API clients with the T-0506 recipe:**
   - the same exported names, types and signatures;
   - the same tolerance;
   - the same error class, status, code and message for every failure, including a network throw and a non-JSON body.
   
   `parseMediaItem` becomes a thin wrapper.
2. **`voice-transcripts.ts`:** `StoredTranscriptSchema` becomes an Effect Schema, still exported under the same name; `StoredTranscript` is its `Type`. `parseTranscripts` keeps the per-entry tolerance. The file-system code does not change.
3. **Remove `zod` from `apps/mobile/package.json`** once grep finds no import left under `apps/mobile`. Run `pnpm install` and commit the lockfile.
4. **Tests:** every existing test passes **unchanged**. You may add one new test file per client for a case the old tests miss.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the mobile API section and the Schema facts), `apps/mobile/src/lib/pins-api.ts`, then the four files and their tests.

### Allowed files
- `apps/mobile/src/lib/media-api.ts`, `apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/integrations-api.ts`, `apps/mobile/src/lib/voice-transcripts.ts`;
- the new, optional test files: `apps/mobile/src/lib/media-api.effect.test.ts`, `apps/mobile/src/lib/groups-api.effect.test.ts` and `apps/mobile/src/lib/integrations-api.effect.test.ts`;
- `apps/mobile/package.json`, `pnpm-lock.yaml`;
- added by the lead on 2026-10-08 (option 1 of the blocked report): `apps/mobile/modules/zilar-whistle/src/result.ts` and `apps/mobile/modules/zilar-whistle/package.json`;
- `work/T-0532-effect-mobile-api-batch-3.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --reporter=dot media groups integrations voice-transcripts new-channel-sheet visibility-fields real-store.channels
pnpm gate
```

### Acceptance
- The four files are on Effect Schema; the three clients run as Effect pipelines.
- zod is gone from `apps/mobile`.
- Every existing test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/mobile/src/lib/media-api.ts`: Effect Schema + the T-0506 pipeline. `parseMediaItem` is now a thin wrapper over `MediaItemSchema`; each optional field uses a lenient decode-to-`undefined` schema (a wrong shape is dropped, not fatal) and `at` keeps the `Date.parse` check. Same `MediaApiError` status/code/message for unauthorized, network throw, non-JSON body, request failure and invalid response.
- `apps/mobile/src/lib/groups-api.ts`: same recipe. The members slice decodes as a whole (a malformed member → `invalid_response`); role/remove accept any JSON object; create acks require `{ id: string }`.
- `apps/mobile/src/lib/integrations-api.ts`: zod removed. `TelegramIntegrationStatus`, `EmailIntegrationStatus`, `VoiceIntegrationStatus`, `IntegrationsStatus` are now `typeof <Schema>.Type` (same shape, `voiceTranscription` still optional). The request pipeline keeps per-field lenient error extraction, so a malformed `code` never discards a valid `message`; errors stay secret-free and no body is logged. `buildSaveEmailBody` / `buildSaveVoiceBody` unchanged.
- `apps/mobile/src/lib/voice-transcripts.ts`: `StoredTranscriptSchema` is now an Effect Schema, `StoredTranscript` its `Type`; `parseTranscripts` uses `Schema.decodeUnknownExit` and keeps the per-entry tolerance; the file-system code is unchanged. Updated the stale "whole-file zod check" comment.
- `apps/mobile/modules/zilar-whistle/src/result.ts` (added to Allowed files by the lead, option 1): `WhistleRawResultSchema` and `WhistleTranscriptSchema` are now `Schema.Struct` with the same field rules (strip unknown keys, `text`/`language` strings, timings numbers); the exported types are `typeof X.Type`; `parseWhistleResult` decodes with `Schema.decodeUnknownExit` and keeps the same `bad_result` branch and language fallback. Used `Schema.Struct` from `effect` (not `@zilar/protocol`'s `struct`) so the only dependency change is the one the lead authorised.
- `apps/mobile/package.json`: removed `"zod": "^4.6.5"`.
- `apps/mobile/modules/zilar-whistle/package.json` (added to Allowed files by the lead): replaced `"zod": "^4.6.5"` with `"effect": "^4.0.2"`.
- `pnpm install` updated `pnpm-lock.yaml`. No test file was changed and no new test was added.

### Commands and real results
- `pnpm install`: ok.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/media-api.test.ts src/lib/groups-api.test.ts src/lib/voice-transcripts.test.ts src/components/integrations/integrations-api.test.ts`: **4 files, 48 tests passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot media groups integrations voice-transcripts new-channel-sheet visibility-fields real-store.channels` (the task's `Checks` selection): **14 files, 130 tests passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/lib/whistle-checksum.test.ts src/lib/whistle-native.test.ts`: **2 files, 22 tests passed**.
- `rg -n "from ['\"]zod['\"]|require\(['\"]zod['\"]\)|\"zod\"" apps/mobile --glob '!**/node_modules/**' --glob '!**/.turbo/**'`: **no matches** (exit 1). The only remaining "zod" text under `apps/mobile` is prose: existing "mobile has no zod" comments in other `*-api.ts` files and `apps/mobile/modules/zilar-whistle/README.md` ("zod-validated"). The README is outside the Allowed files, so I left it untouched.
- `pnpm gate` (final): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/mobile`; `scope: every changed file is inside the Allowed files`; **`GATE PASS`**.

### History (for the merge)
- Gate run 1 failed `format` on `integrations-api.ts` + `media-api.ts`; fixed with `pnpm exec prettier --write` on those two files.
- Gate run 2 failed `typecheck` because `apps/mobile/modules/zilar-whistle/src/result.ts` still imported zod after zod left `apps/mobile`; I reported it as blocked and the lead extended the Allowed files (option 1), which this report reflects.


## Review (written by Claude)

Approved (lead, 2026-10-08). The mobile media, groups and integrations clients and voice-transcripts are on Effect Schema, and after the lead re-scope zilar-whistle result.ts is too. zod is gone from apps/mobile and from the whistle module. phone:smoke passed on the galena AVD. Pre-review clean. Follow-ups for a mobile polish task: the whistle README still says zod-validated, and the media/groups error envelopes decode whole-or-nothing (as in pins); integrations already has the lenient per-field shape.

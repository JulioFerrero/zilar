---
id: T-0532
title: "Effect lane E, batch 3: mobile media-api, groups-api, integrations-api and voice-transcripts onto Effect Schema (+ the T-0506 request pipeline for the API clients); zod leaves apps/mobile; tests unchanged"
status: todo
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

## Review (written by Claude)

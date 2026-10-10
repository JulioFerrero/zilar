---
id: T-1088
title: "api-contract: share the voice-transcription response schemas (EnabledStatus, TranscriptResult) with the server and the mock backend"
status: todo
milestone: M5
branch: task/T-1088-voice-transcription-contract-schemas
model: auto
effort: default
depends_on: [T-1080]
estimate: 0.1 day
---

# T-1088: Voice-transcription response schemas in api-contract

## Spec (written by Claude, do not edit)

### Why
This is the T-1073 follow-up, re-read by the lead on main (2026-10-11):
- **The server's schemas:** `apps/server/src/voice-transcription/schemas.ts:20-21` defines `EnabledStatus = Schema.Struct({ enabled: Schema.Boolean })` and `TranscriptResult = Schema.Struct({ text: Schema.String })`. `apps/server/src/voice-transcription/api.ts:54` imports them.
- **The mock's copies:** `packages/mock-backend/src/domains/voice-transcription/routes.ts:10-18` re-declares the same two shapes as local interfaces, because `@zilar/api-contract` has no voice-transcription file (`packages/api-contract/src/index.ts` has `push` at `:31` but no voice). The shapes can drift apart without anyone noticing.
- **The package is already a dependency:** `@zilar/mock-backend` already imports types from `@zilar/api-contract`, for example `IntegrationsStatus` in `packages/mock-backend/src/domains/integrations/state.ts:7`.

### What to build
1. **A new `packages/api-contract/src/voice-transcription.ts`** that exports `EnabledStatus` and `TranscriptResult` (the schemas, and `type X = typeof X.Type`), moved unchanged from the server. Add one export line to `packages/api-contract/src/index.ts`, after `push`.
2. **The server:** `apps/server/src/voice-transcription/schemas.ts` imports the two from `@zilar/api-contract` and re-exports them, so `api.ts:54` and its other importers keep working. `TranscriptBody`, `VoiceSettingsBody` and `OkResult` stay where they are.
3. **The mock:** `packages/mock-backend/src/domains/voice-transcription/routes.ts` uses the contract types and deletes its two local interfaces. Also fix its stale header comment, which cites the deleted `apps/web/src/mock/api.ts`.
4. **Report the other copies:** `grep` the web and mobile clients for local `{ enabled }` and `{ text }` voice-transcription decoders, and list them with `file:line`. Do not change them; that is a later slice.
5. **No tests,** and no other files change.

### Read first
`AGENTS.md`, `apps/server/src/voice-transcription/schemas.ts`, `apps/server/src/voice-transcription/api.ts`, `packages/api-contract/src/push.ts` (the file shape), `packages/api-contract/src/index.ts`, and `packages/mock-backend/src/domains/voice-transcription/routes.ts`.

### Allowed files
`packages/api-contract/src/voice-transcription.ts`, `packages/api-contract/src/index.ts`, `apps/server/src/voice-transcription/schemas.ts`, `packages/mock-backend/src/domains/voice-transcription/routes.ts`, `work/T-1088-voice-transcription-contract-schemas.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The Checks pass.
- The Report lists the client copies.

---

## Report (written by the worker when done)

## Review (written by Claude)

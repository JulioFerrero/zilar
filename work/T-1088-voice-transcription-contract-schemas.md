---
id: T-1088
title: "api-contract: share the voice-transcription response schemas (EnabledStatus, TranscriptResult) with the server and the mock backend"
status: merged
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

### What I did
1. Added `packages/api-contract/src/voice-transcription.ts`, exporting `EnabledStatus` and
   `TranscriptResult` (the `Schema.Struct`s plus `type X = typeof X.Type`), moved from the
   server's schema file. One export line added to `packages/api-contract/src/index.ts`
   (`export * from './voice-transcription';`), placed after `push` as the spec says.
2. `apps/server/src/voice-transcription/schemas.ts` now re-exports both from
   `@zilar/api-contract` (`export { EnabledStatus, TranscriptResult } from '@zilar/api-contract';`),
   so `api.ts:48-54` and the other importers keep working. `TranscriptBody`,
   `VoiceSettingsBody` and `OkResult` stay in place; the `OkResult` comment was trimmed since the
   other two fields moved out.
3. `packages/mock-backend/src/domains/voice-transcription/routes.ts` now imports
   `type { EnabledStatus, TranscriptResult }` from `@zilar/api-contract` and the two local
   interfaces are deleted. The stale header comment (it cited the deleted
   `apps/web/src/mock/api.ts`) was rewritten to point at `@zilar/api-contract`.
4. No tests added (spec: no tests, no other files change).

### Files I changed
- `packages/api-contract/src/voice-transcription.ts` (new)
- `packages/api-contract/src/index.ts`
- `apps/server/src/voice-transcription/schemas.ts`
- `packages/mock-backend/src/domains/voice-transcription/routes.ts`
- `work/T-1088-voice-transcription-contract-schemas.md`

### Client copies (not changed — later slice)
Web (`apps/web/src/lib/api/settings.ts`):
- `:67-68` `getVoiceTranscriptionStatus(): Promise<{ enabled: boolean }>` decoding
  `struct({ enabled: Schema.Boolean })`.
- `:71-72` `getVoiceTranscript(...): Promise<{ text: string }>` decoding
  `struct({ text: Schema.String })`.

Mobile (`apps/mobile/src/lib/integrations-api.ts`):
- `:34` `const VoiceTranscriptionStatusSchema = struct({ enabled: Schema.Boolean });`
- `:52` interface return type `getVoiceTranscriptionStatus(): Promise<{ enabled: boolean }>`.

Mobile has no `{ text }` voice-transcription decoder: it transcribes on-device
(`apps/mobile/src/lib/voice-transcripts.ts`), a different path.

### Commands I ran
- `pnpm install` — done, "Done in 11.5s".
- `pnpm gate` — 5 changed files against main:

  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (0.7s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.3s)
  PASS  effect  (0.7s)
  SKIP tests @zilar/api-contract (no nearby test files)
  SKIP tests @zilar/mock-backend (no nearby test files)
  SKIP tests @zilar/server (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

No single test file was run: the change is type/schema re-export only and the spec says no tests,
so there is no file-level test to filter. The gate's nearest-test step found none to run.

### Deviations / open questions
None.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The change:**
  - `packages/api-contract/src/voice-transcription.ts` holds `EnabledStatus` and `TranscriptResult`, moved unchanged from the server, and is exported from the index;
  - `apps/server/src/voice-transcription/schemas.ts` re-exports them, so `api.ts:54` is unchanged;
  - the mock route uses the contract types, and its stale header comment is fixed.
- **The Report** lists the client copies, at the lines it gives in `apps/web/src/lib/api/settings.ts` and `apps/mobile/src/lib/integrations-api.ts`, for a later slice.
- **Check:** the gate passed, including typecheck across the server, the contract and the mock backend. Only types moved, so the lead ran no UI check.

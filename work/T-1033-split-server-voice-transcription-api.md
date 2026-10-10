---
id: T-1033
title: "Size split T110: apps/server/src/voice-transcription/api.ts (422 lines) into voice-transcription/{schemas,middleware}.ts, api.ts keeps deps, limiter, group, handlers and mount"
status: merged
milestone: M5
branch: task/T-1033-split-server-voice-transcription-api
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.25 day
---

# T-1033: Split `voice-transcription/api.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/voice-transcription/api.ts` is 422 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.2 #106 (task T110): `voice-transcription/schemas.ts` and `voice-transcription/middleware.ts`, under `apps/server/src/`. `api.ts` keeps the deps, the limiter setup, the group, the handlers, the mount and every export it has today. The folder already holds `pipeline.ts`, `provider.ts`, `routes.ts` and `settings.ts`; leave them as they are.

Move the code unchanged, and skip both Dedup items. The two middleware layers decide who may transcribe, which is permissions code: not one line of them changes.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.2 #106, and `apps/server/src/voice-transcription/api.ts`.

### Allowed files
`apps/server/src/voice-transcription/api.ts`, `apps/server/src/voice-transcription/schemas.ts`, `apps/server/src/voice-transcription/middleware.ts`, `work/T-1033-split-server-voice-transcription-api.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did

Followed `docs/audit/split-rules.md` and size-plan §2.2 #106. Moved code unchanged
from `apps/server/src/voice-transcription/api.ts` into two new files; both Dedup
items were skipped, as the spec says, so the two middleware layers that decide who
may transcribe are byte-for-byte the same permission code.

- `voice-transcription/schemas.ts` (new): `TranscriptBody`, `VoiceSettingsBody`,
  `EnabledStatus`, `TranscriptResult`, `OkResult` (plan lines 61–80). The five
  names are now `export const`; they were module-private before, so `api.ts` can
  import them.
- `voice-transcription/middleware.ts` (new): `TranscriptConfigured` +
  `transcriptConfiguredLayer`, `VoiceSettingsOwnerLimit` +
  `voiceSettingsOwnerLimitLayer` (plan lines 87–153). The two classes and two
  layers are now exported for the same reason.
- `voice-transcription/api.ts`: the deps, the limiter setup, the group, the
  handlers, the mount and the `createVoiceTranscriptionApi` export all stay; it now
  imports the moved symbols.

No file outside the Allowed files changed. No importer changed: `apps/server/src/app.ts:61`
still imports `createVoiceTranscriptionApi` from the same path.

### Sizes (`wc -l`)

| file | before | after |
| --- | --- | --- |
| `voice-transcription/api.ts` | 422 | 331 |
| `voice-transcription/schemas.ts` | — | 22 |
| `voice-transcription/middleware.ts` | — | 80 |

All under 400.

### Export diff (`grep -E "^export"`, old `api.ts` vs `api.ts` + the new files)

Before (main `api.ts`):
```
export function createVoiceTranscriptionApi(
```
After:
```
api.ts          export function createVoiceTranscriptionApi
schemas.ts      export const TranscriptBody
schemas.ts      export const VoiceSettingsBody
schemas.ts      export const EnabledStatus
schemas.ts      export const TranscriptResult
schemas.ts      export const OkResult
middleware.ts   export class TranscriptConfigured
middleware.ts   export function transcriptConfiguredLayer
middleware.ts   export class VoiceSettingsOwnerLimit
middleware.ts   export function voiceSettingsOwnerLimitLayer
```
The public surface is unchanged: the only name another file imports from this
module (`createVoiceTranscriptionApi`, `apps/server/src/app.ts:61`) is the same.
The extra exports are the moved, previously private symbols that `api.ts` imports.

### Effect ratchet (rule 6)

No `// effect-plain:` marker was added. `schemas.ts` imports `Schema` and
`middleware.ts` imports `Effect`/`Layer` as values, so the map classifies both
`effect`; the gate printed `PASS effect`.

### Commands and real results

- `pnpm install` — done (23.4s); the peer-dependency warning for
  `@types/react-dom` on `apps/mobile` is pre-existing and unrelated.
- No single test file was run: the `voice-transcription` folder holds no test files
  and no server test references the module (searched), so there was nothing near
  the change to run.
- `pnpm gate` (repo root):
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.9s)
PASS  format  (0.4s)
PASS  lint  (0.6s)
PASS  typecheck  (3.8s)
PASS  effect  (1.0s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```
  The first gate run failed `lint` with `RateLimiter` imported but unused in
  `api.ts` (that type moved to `middleware.ts`); I removed it and the second run
  printed `GATE PASS`.

### Deviations

- The plan's `middleware.ts` range is 87–153; I also moved the comment at lines
  82–86 because it documents `TranscriptConfigured`. No code changed.
- Both Dedup items were skipped, as the spec requires.

### Blocked / needs a decision

None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The split:** `voice-transcription/api.ts` (422 lines) is now 331 lines, plus `schemas` (22) and `middleware` (80).
- **The lead's line check:** the old file's non-import code lines against the new files'. Only import-list names differ, so the two permission middleware layers are unchanged.
- **Check:** the gate passed.

---
id: T-0673
title: "effect/sql: move the voice transcript fast-path cache read in voice-transcription/api.ts (~line 298) onto effect/sql and drop the file's drizzle imports"
status: merged
milestone: M5
branch: task/T-0673-voice-api-fast-path-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0673: voice API fast-path read on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `voice-transcription/api.ts` has one drizzle read left.

### Verified facts (do not re-derive)
- **`apps/server/src/voice-transcription/api.ts:298-304`:**
  - `const [fastHit] = yield* Effect.promise(() => db.select({ text: voiceTranscripts.text }).from(voiceTranscripts).where(eq(voiceTranscripts.urlHash, urlHash)).limit(1))`;
  - it is the only use of `eq` (line 17) and `voiceTranscripts` (line 20);
  - `Effect.promise` makes a DB failure a defect.
- **The runtime:** `sqlRuntimeFor(db)` in `apps/server/src/effect/sql.ts:98`. The model to copy is `apps/server/src/voice-transcription/settings.ts:36-60`, which uses `runSql` and `` sql<Row>`SELECT …` ``.
- **Tests:** `apps/server/src/voice-transcription/routes.test.ts`, including line 185 ("transcribes once and serves the cached text to a second tap and another user").

### What to build
1. **Replace the read** with `yield* Effect.promise(() => sqlRuntimeFor(db).runPromise(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<{ text: string }>`SELECT text FROM voice_transcripts WHERE url_hash = ${urlHash} LIMIT 1`; })))`. It keeps the same defect behaviour and the same `fastHit` shape.
2. **Remove the drizzle import** and the `voiceTranscripts` import, and add the needed imports.
3. **Change nothing else.**

### Read first
`AGENTS.md`, `apps/server/src/voice-transcription/api.ts` (lines 1-40 and 285-330), `apps/server/src/voice-transcription/settings.ts` (lines 36-60).

### Allowed files
`apps/server/src/voice-transcription/api.ts`, `work/T-0673-voice-api-fast-path-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription/routes.test
pnpm gate
```

### Acceptance
- `voice-transcription/api.ts` has no drizzle import.
- The voice tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/server/src/voice-transcription/api.ts`: the fast-path cache read (was lines 298-304) now runs `sqlRuntimeFor(db).runPromise(Effect.gen(...))` with `` sql<{ text: string }>`SELECT text FROM voice_transcripts WHERE url_hash = ${urlHash} LIMIT 1` `` inside the same `Effect.promise`, so a DB failure is still a defect and `fastHit` keeps its shape.
- Removed `import { eq } from 'drizzle-orm'` and `import { voiceTranscripts } from '../db/schema'`. Added `import { SqlClient } from 'effect/sql'` and `import { sqlRuntimeFor } from '../effect/sql'`.
- `prettier --write` on that one file (the first gate run failed format on it). The only change it made was the line wrap of the `sql<{ text: string }>` generic.
- Status set to `in-progress`, then `review`. Nothing else in the task file changed.

**Files changed:** `apps/server/src/voice-transcription/api.ts`, `work/T-0673-voice-api-fast-path-effect-sql.md`.

**Checks**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription/routes.test`: 25 passed, 0 failed (1 file). The test file was not edited. It imports `eq` from drizzle but does not mock it.
- `pnpm gate` (final run): `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`, `scope: every changed file is inside the Allowed files`, `GATE PASS`. Earlier run failed only on `format` (prettier on api.ts), fixed as above.

**Problems / deviations**
- The header comment at `api.ts:4` still says "Handlers keep calling the drizzle pipeline". I left it because the spec says change nothing else. It is now stale for this handler; the lead can decide whether to fix it.
- Acceptance "no drizzle import": `grep -c drizzle` on the file gives 1, but that is the comment on line 4, not an import.

**Open questions**
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.4 min). The lead reviewed the diff directly: the same read with the same defect behaviour, and no drizzle import. The gate passed.
- **Follow-up (noted by the worker):** the header at `voice-transcription/api.ts:4` still says it calls the drizzle pipeline.

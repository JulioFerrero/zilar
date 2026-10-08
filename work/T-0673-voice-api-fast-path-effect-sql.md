---
id: T-0673
title: "effect/sql: move the voice transcript fast-path cache read in voice-transcription/api.ts (~line 298) onto effect/sql and drop the file's drizzle imports"
status: todo
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

## Review (written by Claude)

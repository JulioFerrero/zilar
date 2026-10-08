---
id: T-0669
title: "effect/sql (C4): move storeTranscriptEffect in voice-transcription/pipeline.ts (advisory lock + cached check + insert, then re-read) onto effect/sql with sql.withTransaction; same defect behaviour"
status: todo
milestone: M5
branch: task/T-0669-voice-transcript-store-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0669: voice transcript store on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `voice-transcription/pipeline.ts` holds the last drizzle code in the voice module.

### Verified facts (do not re-derive)
- **`apps/server/src/voice-transcription/pipeline.ts:151-191`:**
  - `awaitDb` (line 156) lifts a drizzle promise with `Effect.promise`, so a DB failure is a defect and rejects the boundary promise with the original error (the comment at lines 151-155);
  - `storeTranscriptEffect(db, urlHash, result)` (line 159) runs `db.transaction` with three steps: `SELECT pg_advisory_xact_lock(hashtext('voice-transcript:' || urlHash))`; select `text` from `voice_transcripts` where `url_hash = urlHash`, returning early if it is found; otherwise insert `(url_hash, text, language)` with `ON CONFLICT (url_hash) DO NOTHING`;
  - after the commit it re-reads `text` for `urlHash` and returns `stored?.text ?? result.text`.
- **Imports:** lines 17-21 import `eq` and `sql` from drizzle-orm, `voiceTranscripts` and `SetupTransaction`; these are their only uses.
- **The `sql.withTransaction` model:** `apps/server/src/agents/memory/store.ts:394` and `apps/server/src/voice-transcription/settings.ts:80-100`. The runtime is `sqlRuntimeFor(db)` from `apps/server/src/effect/sql.ts:98`.
- **Tests:** `apps/server/src/voice-transcription/routes.test.ts:185` ("transcribes once and serves the cached text to a second tap and another user") covers the store; `apps/server/src/voice-transcription/pipeline.test.ts` covers the error mapping.

### What to build
1. **Rewrite `storeTranscriptEffect`** with effect/sql: one `sql.withTransaction` with the same three steps in the same order. The lock text must be the same: `hashtext(${'voice-transcript:' + urlHash})`. After it, run the same re-read.
2. **Run it as `Effect.promise(() => sqlRuntimeFor(db).runPromise(effect))`,** so a SQL failure stays a defect with the original error, exactly as `awaitDb` behaves now. Keep or adapt `awaitDb` and its comment to match.
3. **Remove the drizzle imports** that become unused, and `SetupTransaction`.
4. **Change no other function.**

### Read first
`AGENTS.md`, `apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/voice-transcription/settings.ts` (lines 36-120), `apps/server/src/agents/memory/store.ts` (lines 385-420).

### Allowed files
`apps/server/src/voice-transcription/pipeline.ts`, `work/T-0669-voice-transcript-store-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription
pnpm gate
```

### Acceptance
- `pipeline.ts` has no drizzle import.
- The voice tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

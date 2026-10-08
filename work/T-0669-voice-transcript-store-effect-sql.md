---
id: T-0669
title: "effect/sql (C4): move storeTranscriptEffect in voice-transcription/pipeline.ts (advisory lock + cached check + insert, then re-read) onto effect/sql with sql.withTransaction; same defect behaviour"
status: merged
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
`apps/server/src/voice-transcription/pipeline.ts`, `apps/server/src/voice-transcription/pipeline.test.ts` (lead, 2026-10-09: only the "DB failure rejects with the original error" test, which mocked a drizzle `db.transaction`), `work/T-0669-voice-transcript-store-effect-sql.md`.

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

**Status: review. `pnpm gate` ends GATE PASS.** The earlier blocker was resolved by the lead (see "Problems / deviations").

### What I did
- `apps/server/src/voice-transcription/pipeline.ts`:
  - Replaced `awaitDb` with `awaitSql(db, effect)`: `Effect.promise(() => sqlRuntimeFor(db).runPromise(effect))`.
  - `storeTranscriptEffect` now runs one `sql.withTransaction` with the same three steps in the same order: advisory lock `hashtext(${'voice-transcript:' + urlHash})`, select `text` (return early if found), `INSERT ... ON CONFLICT (url_hash) DO NOTHING`. The re-read after the commit is also on effect/sql.
  - Removed the drizzle imports (`eq`, `sql`, `voiceTranscripts`) and `SetupTransaction`. Added `SqlClient`, `SqlError` from `effect/sql` and `sqlRuntimeFor` from `../effect/sql`.
  - Changed one header comment line that still named drizzle queries in this module. Ran prettier on this one file.
- `apps/server/src/voice-transcription/pipeline.test.ts`: only the imports, a `vi.mock('../effect/sql')` that wraps `sqlRuntimeFor` in `vi.fn` (other exports stay real), and the body of "a DB failure rejects with the original error, identical and unwrapped". That test now queues a one-off runtime whose `runPromise` rejects with `dbDown`, and keeps `expect(error).toBe(dbDown)`. All other tests are unchanged.
- No other function or file was touched.

### Commands (real results)
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription` (after the test change): 4 files passed, 40 tests passed (40).
- Earlier, before the test change: 1 failed, 39 passed. The failure was the DB-failure test, which got "No effect/sql runtime registered for this database" instead of `db down`.
- `pnpm gate` (final run): install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/server PASS, `scope: every changed file is inside the Allowed files`, GATE PASS.

### Problems / deviations
- Lead decision (coordinator message): `pipeline.test.ts` is an Allowed file, for the DB-failure test only. The lead also added it to the Allowed files line in the Spec (uncommitted, in this worktree); I included that Spec edit in the commit. I did not change the Spec myself.
- Reason: the old test's fake `db` was `{ transaction: () => Promise.reject(dbDown) }`, a drizzle-only shape. With effect/sql the store never calls `db.transaction`, so the test hit the registration error instead of `dbDown`.
- Gate scope: the scope check passes with no flag, because of the lead's Allowed-files edit.
- Not verified: the DB-failure path with a real failing SQL client. The claim that `runPromise` rejects with the original error relies on the existing `runSql` pattern in `settings.ts` and `store.ts`, not on a test I ran. The DB-failure test only proves the boundary passes the runtime's rejection through unchanged.
- Not verified: the DB-failure path with a real failing SQL client. The claim that `runPromise` rejects with the original error relies on the existing `runSql` pattern in `settings.ts` and `store.ts`, not on a test I ran.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, as a Claude Code subagent, in 2 rounds (about 4 min, then 7 min).
- **Round 1:** it stopped correctly. The DB-failure test mocked a drizzle `db.transaction`, so the lead allowed `pipeline.test.ts` for that one test.
- **Result:** the store runs one `sql.withTransaction` with the same lock key, the cached check and `ON CONFLICT DO NOTHING`, then the same re-read. A SQL failure is still a defect carrying the original error. The rewritten test mocks only `sqlRuntimeFor`, once, and every other test is unchanged. The gate passed.
- **Follow-up:** the header comment still mentions Hono and zod.

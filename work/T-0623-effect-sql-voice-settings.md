---
id: T-0623
title: "effect/sql: voice-transcription/settings.ts off drizzle; save and delete run their own sql.withTransaction, and the two deps.db.transaction wrappers in voice-transcription/api.ts go; same keys, same encryption, same answers; tests unchanged"
status: todo
milestone: M5
branch: task/T-0623-effect-sql-voice-settings
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0623: voice transcription settings on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql` and `sql.withTransaction`).

### Verified facts (do not re-derive; read the whole file, 91 lines)
- **`apps/server/src/voice-transcription/settings.ts`:**
  - `getVoiceTranscriptionSettings(db, cipher)` (31): reads every `instance_settings` row and picks three keys;
  - `saveVoiceTranscriptionSettings(tx: SetupTransaction, cipher, settings)` (49): upserts the base URL and the model, then deletes the API key row when `apiKey` is null, or upserts it encrypted;
  - `deleteVoiceTranscriptionSettings(tx: SetupTransaction)` (83): deletes the three keys.
- **The table** (`apps/server/src/db/schema.ts:31-35`) is `instance_settings`, with `key` (primary key), `value` and `updated_at`. An upsert is `INSERT … ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`.
- **The only callers:**
  - `voice-transcription/api.ts:239`: get, with the top-level `db`;
  - `voice-transcription/api.ts:411-415`: save, inside a `deps.db.transaction` that holds nothing else;
  - `voice-transcription/api.ts:444-448`: delete, the same way;
  - `voice-transcription/routes.ts:116`: get;
  - `voice-transcription/routes.test.ts`: get at 460, 536, 556 and 595.

### What to build
1. **`settings.ts`:**
   - `saveVoiceTranscriptionSettings(db: ServerDatabase, cipher, settings)` and `deleteVoiceTranscriptionSettings(db: ServerDatabase)` each run all their statements in **one** `sql.withTransaction` through a private `runSql(db, effect)`;
   - `getVoiceTranscriptionSettings` keeps its signature;
   - the file keeps no value import from `drizzle-orm` or `db/schema`, and no `SetupTransaction`.
2. **`api.ts`:**
   - at 411-415 and 444-448, call the two functions directly with `deps.db` inside the existing `Effect.promise`, and drop the `deps.db.transaction` wrappers;
   - drop the `SetupTransaction` import from line 59 if nothing else uses it;
   - change nothing else in the file.
3. **Tests:** everything under `apps/server/src/voice-transcription` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/voice-transcription/settings.ts` and `apps/server/src/voice-transcription/api.ts` (lines 230-245 and 395-460).

### Allowed files
`apps/server/src/voice-transcription/settings.ts`, `apps/server/src/voice-transcription/api.ts`, `work/T-0623-effect-sql-voice-settings.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription
pnpm gate
```

### Acceptance
- Voice settings read and write on effect/sql. Save and delete are each atomic.
- The keys, the encryption and the answers are unchanged.
- Every test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

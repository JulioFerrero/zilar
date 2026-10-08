---
id: T-0623
title: "effect/sql: voice-transcription/settings.ts off drizzle; save and delete run their own sql.withTransaction, and the two deps.db.transaction wrappers in voice-transcription/api.ts go; same keys, same encryption, same answers; tests unchanged"
status: merged
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

status: review

### What I did
- `apps/server/src/voice-transcription/settings.ts` moved off drizzle:
  - `getVoiceTranscriptionSettings(db, cipher)` keeps its signature but now
    reads `SELECT key, value FROM instance_settings` through a private
    `runSql(db, effect)` (`sqlRuntimeFor(db).runPromise`).
  - `saveVoiceTranscriptionSettings(db, cipher, settings)` now takes
    `db: ServerDatabase` and runs the two upserts plus the API-key delete/upsert
    in one `sql.withTransaction`, so the write is atomic.
  - `deleteVoiceTranscriptionSettings(db)` runs its three deletes in one
    `sql.withTransaction`.
  - Upsert is `INSERT … ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value,
    updated_at = now()`, matching the old drizzle `onConflictDoUpdate`.
  - The file no longer imports `eq`, `instanceSettings`, or `SetupTransaction`;
    no value import from `drizzle-orm` or `db/schema` remains.
- `apps/server/src/voice-transcription/api.ts`:
  - `saveVoiceTranscriptionSettings` and `deleteVoiceTranscriptionSettings` are
    called directly with `deps.db` inside the existing `Effect.promise`; the two
    `deps.db.transaction` wrappers are gone.
  - Dropped the now-unused `type SetupTransaction` from the
    `../setup/settings` import. Nothing else in the file changed.
- Tests were not touched. `pipeline.ts` still uses `SetupTransaction` and is out
  of scope; untouched.

### Files changed
- `apps/server/src/voice-transcription/settings.ts`
- `apps/server/src/voice-transcription/api.ts`
- `work/T-0623-effect-sql-voice-settings.md` (status only)

### Commands and real results
- `pnpm install`: done, 1173 packages, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription`:
  `Test Files 4 passed (4)`, `Tests 40 passed (40)`.
- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.9s)
  PASS  format  (23.1s)
  PASS  lint  (1.1s)
  PASS  typecheck  (9.9s)
  PASS  tests @zilar/server  (21.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (A first gate run failed only on `format` for `api.ts`; I collapsed one
  `Effect.promise` call onto one line and re-ran to the pass above.)

### Deviations / problems
- None from the spec. The encryption (`cipher.encrypt`), the setting keys and
  the returned shape are unchanged; the only read change is selecting
  `key, value` instead of every column, which `getVoiceTranscriptionSettings`
  already reduced to those two keys.

### Security checklist
- No secret is logged or returned: the API key path is unchanged (encrypted at
  rest, masked in responses). The fixed warning text in `storedSettings` is
  untouched.
- Deletes are scoped by the three named setting keys, as before.
- Save and delete are each atomic in one `sql.withTransaction`; the API-key
  delete/upsert stays in the same transaction as the base URL and model.
- No new route, no new dependency, no test changed.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is d22630af, the current HEAD.
- **Lead check of the diff:**
  - save and delete each run in one `sql.withTransaction`, with the same keys and the same upsert;
  - encryption happens before the transaction, and only the encrypted value reaches SQL;
  - `api.ts` lost only its two wrappers and the type import.

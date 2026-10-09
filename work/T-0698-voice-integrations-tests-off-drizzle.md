---
id: T-0698
title: "tests off drizzle (voice-transcription + integrations): replace every drizzle query in voice-transcription/routes.test.ts, integrations/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0698-voice-integrations-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0698: voice-transcription + integrations tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the voice-transcription + integrations folder.

### Verified facts (do not re-derive)
- `apps/server/src/voice-transcription/routes.test.ts` (621 lines): drizzle at lines 10, 13, 154, 212, 308, 330, 388, 413, 465, 612.
- `apps/server/src/integrations/routes.test.ts` (515 lines): drizzle at lines 9, 13, 153, 325, 332, 382, 405, 432, 493.
- **`testSql(context)`** is in `apps/server/src/test-support.ts` (T-0695). Use it as `await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<Row>\`...\`; }))`, with the imports `import { Effect } from 'effect'; import { SqlClient } from 'effect/sql';`. The worked example is `apps/server/src/pins/pins.test.ts`.
- **Results come back camelCased** (`transformResultNames`, `apps/server/src/effect/sql.ts:56`), and the SQL must name the **snake_case** columns. Keys passed to `sql.insert(...)` must be snake_case too. `"user"` must be quoted. Use `count(*)::int` for counts, and `${JSON.stringify(value)}::jsonb` for jsonb.
- **Drizzle filled some columns in JavaScript** (`$defaultFn`, `$onUpdate` in `apps/server/src/db/schema.ts`). The database does not, so a raw insert must give those values itself: check each table's columns in `schema.ts`. Columns with a SQL default (`defaultNow()`, `default(...)`) can be left out.

### What to build
1. **In each file above,** replace every drizzle query (seed inserts, updates, deletes, reads used by assertions) with `testSql(context)(...)`. Keep the same rows, values, order and assertions. Select only the columns a test reads, and give them a small local row type.
2. **Remove** the `drizzle-orm` and `../db/schema` imports, including any dynamic `import('../db/schema')`.
3. **Leave alone** the lines that pass `context.db` to a module function (`db: context.db`, `claimHandle(context.db, …)`): they are not drizzle queries.
4. **Values whose JS type differs** from drizzle (timestamps, numerics, jsonb): adapt only the read, never the meaning of an assertion. If a test cannot pass without changing what it checks, stop and ask (status: blocked).

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` §2 (lines 249-390), `apps/server/src/pins/pins.test.ts` (the worked example), the files above, and the matching tables in `apps/server/src/db/schema.ts`.

### Allowed files
`apps/server/src/voice-transcription/routes.test.ts`, `apps/server/src/integrations/routes.test.ts`, `work/T-0698-voice-integrations-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/voice-transcription/routes.test.ts src/integrations/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/voice-transcription/routes.test.ts apps/server/src/integrations/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/voice-transcription/routes.test.ts`: all 8 drizzle query sites (1 `instance_settings` update, 3 `voice_transcripts` reads, 1 `instance_settings` read, 3 `audit_log` reads) now run through `testSql(context)(Effect.gen(...))` with raw SQL on snake_case columns. Removed the `drizzle-orm` and `../db/schema` imports. Added local row types (`AuditRow`, `SettingRow`, `TranscriptRow`, `UrlHashRow`).
- `apps/server/src/integrations/routes.test.ts`: same treatment for its 7 drizzle query sites (1 `instance_settings` key read, 3 full-table `instance_settings` reads, 3 `audit_log` reads: `telegram_set`, `telegram_removed`, `email_set`). Removed the same two imports. Local row types: `AuditRow`, `SettingRow`, `SettingKeyRow`, `KeyRow`.
- Left alone: every `context.db` passed to a module function (`getStoredTelegramToken`, `getVoiceTranscriptionSettings`, `createAuditRecorder`, etc.).
- No inserts or deletes existed in these two files, so no JS-filled columns (`$defaultFn`/`$onUpdate`) had to be supplied.
- Quoted `"at"` in the audit selects, to be safe.

### Test counts (single files, `--maxWorkers=2 --reporter=dot`)
- Before: `src/voice-transcription/routes.test.ts` + `src/integrations/routes.test.ts`: 2 files, 47 passed.
- After: same command: 2 files, 47 passed.

### Acceptance grep
- `git grep -n "drizzle-orm\|db/schema" -- <both files>`: prints nothing (exit 1).
- `grep` for `context.db.` / `eq(` in both files: nothing left.

### pnpm gate (from `/Users/julio/personal-projects/zilar-T-0698`, log kept in the scratchpad, not the worktree)
- `pnpm install` before the work: exit 0.
- `gate: 3 changed file(s) against main`
- `PASS  install (frozen)`, `PASS  format`, `PASS  lint`, `PASS  typecheck`, `PASS  tests @zilar/server`
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`

### Deviation / judgement call
- The audit_log selects list all 12 columns, not a subset. The tests serialise the whole row (`JSON.stringify(rows[0])`) to prove no secret is in any column, so selecting fewer columns would weaken that assertion. The values and assertions are unchanged.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 12 min). The lead reviewed the diff directly. The settings, transcript and audit reads are on `testSql`. The audit reads keep every column on purpose, because those tests serialise the whole row to prove no secret leaks. There are 47 tests before and after, and the gate passed.

---
id: T-0622
title: "effect/sql: the owner and owner-email lookups in integrations/routes.ts and voice-transcription/routes.ts off drizzle (isOwner twice, ownerEmailFor); same answers, same 404; tests unchanged"
status: merged
milestone: M5
branch: task/T-0622-effect-sql-owner-lookups
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.25 day
---

# T-0622: owner lookups on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive)
- **`apps/server/src/integrations/routes.ts`** has two statements, the only drizzle use in that file (imports at 10 and 17):
  - `isOwner` (76-83): the first user by `created_at`, then `id`; `true` when that is `userId`;
  - `ownerEmailFor` (187-197): the email by id; a missing row throws `notFound()` (404 `not_found`).
- **`apps/server/src/voice-transcription/routes.ts`** has a copy of `isOwner` (89-96), the only drizzle use in that file (imports at 43 and 49).
- **The table is `"user"`** (`apps/server/src/auth/auth-schema.ts:4`; a reserved word, so quote it in SQL), with the columns `id`, `email` and `created_at`.
- **Callers** pass the top-level `db`, never a transaction: `integrations/api.ts:158,194,277,427` and `voice-transcription/api.ts:441,474`. Keep each signature, `db: ServerDatabase` included.

### What to build
1. Move the three functions to effect/sql in their own files, with the same ordering (`ORDER BY created_at ASC, id ASC LIMIT 1`), the same answers and the same 404. Neither file keeps a value import from `drizzle-orm` or `db/schema`.
2. **Tests:** everything under `apps/server/src/integrations` and `apps/server/src/voice-transcription` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), and the two routes files.

### Allowed files
`apps/server/src/integrations/routes.ts`, `apps/server/src/voice-transcription/routes.ts`, `work/T-0622-effect-sql-owner-lookups.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/integrations src/voice-transcription
pnpm gate
```

### Acceptance
- The three lookups run on effect/sql with the same behaviour.
- Every test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
Converted the three owner lookups from drizzle to `effect/sql`, in place, keeping
the exported signatures (`db: ServerDatabase` included) and the same answers:

- `apps/server/src/integrations/routes.ts`
  - `isOwner` (was 76-83) now runs
    `` SELECT id FROM "user" ORDER BY created_at ASC, id ASC LIMIT 1 ``
    on `effect/sql` and compares the first `id` with `userId`.
  - `ownerEmailFor` (was 187-197) now runs
    `` SELECT email FROM "user" WHERE id = ${userId} LIMIT 1 ``;
    a missing row still throws `notFound()` (404 `not_found`).
  - Added a private `runSql(db, effect)` helper that calls
    `sqlRuntimeFor(db).runPromise(effect)`, matching the pins recipe
    (`pins/service.ts:60-65`).
  - Removed `import { asc, eq } from 'drizzle-orm'` and
    `import { user } from '../db/schema'`; added `Effect`, `SqlClient`/`SqlError`
    and `sqlRuntimeFor`.
- `apps/server/src/voice-transcription/routes.ts`
  - `isOwner` (was 89-96) converted the same way (same `ORDER BY`, same quote on
    the reserved `"user"` table).
  - Same import swap (`Effect`, `SqlClient`/`SqlError`, `sqlRuntimeFor`; dropped
    `drizzle-orm` and `db/schema`).

Both files now have no value import from `drizzle-orm` or `db/schema`.
Callers were not touched: `integrations/api.ts:158,194,277,427` and
`voice-transcription/api.ts:441,474` still pass the top-level `db`, and the
signatures are unchanged.

Note on "in their own files": the Allowed files list only the two route files,
so I read that as "each function converted inside the file it already lives in"
rather than creating new modules (which would be outside scope).

### Files changed
- `apps/server/src/integrations/routes.ts`
- `apps/server/src/voice-transcription/routes.ts`
- `work/T-0622-effect-sql-owner-lookups.md`

No test file changed (`git status --short` shows only the three files above).

### Checks (real results)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/integrations src/voice-transcription`
  → `Test Files 5 passed (5)`, `Tests 62 passed (62)`.
- `pnpm gate` (from repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (15.7s)
  PASS  lint  (1.5s)
  PASS  typecheck  (8.8s)
  PASS  tests @zilar/server  (9.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
- None. Tests pass unchanged. I checked for tests that fake drizzle `db.select`
  in the two folders: the `.select()` calls in `routes.test.ts` only read back
  `instance_settings`/`voice_transcripts` rows for assertions, they do not patch
  or replace the db, so the conversion does not break them.

### Open questions
- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet head is 0763bd33, the current HEAD.
- **Lead check of the diff:**
  - both `isOwner` copies keep `ORDER BY created_at, id LIMIT 1` on the quoted `"user"` table;
  - `ownerEmailFor` keeps its 404;
  - no drizzle import is left in either file.
- **Nit:** the `runSql` copy in each file is accepted, because the Allowed files allowed no shared module.

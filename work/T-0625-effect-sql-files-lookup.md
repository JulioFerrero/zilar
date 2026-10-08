---
id: T-0625
title: "effect/sql: the file proxy row lookup (files/api.ts findFileRow) off drizzle; select only the columns the route reads (kind, mime, name); same 404s and headers; tests unchanged"
status: merged
milestone: M5
branch: task/T-0625-effect-sql-files-lookup
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.25 day
---

# T-0625: file proxy lookup on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive)
- **`apps/server/src/files/api.ts`** has one statement, `findFileRow` (95-115). It selects the `media_items` row where:
  - `archive_owner`, `chat_jid` and `url` equal the inputs;
  - `deleted = false`;
  - `kind <> 'link'`;
  - `LIMIT 1`.

  It is called at 225 and 259 with the top-level `deps.db`.
- **The drizzle imports** are at 17 (`and, eq, ne`) and 26 (`mediaItems`). `FilesItemRow` (93) is `typeof mediaItems.$inferSelect`.
- **The route reads only three fields of the row:** `row.mime` (132), `row.kind` (148) and `row.name` (149), plus the `undefined` check (around 233).
- **`media_items.at_micros` is a `bigint`** (`apps/server/src/db/schema.ts:1400`). A `SELECT *` would bring it back as a string, not the number the drizzle type promises. Select only `kind`, `mime` and `name`.

### What to build
1. **Move `findFileRow` to effect/sql:**
   - `SELECT kind, mime, name FROM media_items WHERE … LIMIT 1`, with the same five conditions;
   - change `FilesItemRow` to a local `{ kind: string; mime: string | null; name: string | null }`, matching the schema's nullability (check `schema.ts:1394-1420`);
   - the file keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** `apps/server/src/files/routes.test.ts` passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/files/api.ts`.

### Allowed files
`apps/server/src/files/api.ts`, `work/T-0625-effect-sql-files-lookup.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files
pnpm gate
```

### Acceptance
- The lookup runs on effect/sql and answers exactly as before.
- The test file is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0625-effect-sql-files-lookup`.

### What I did
- Moved the single row lookup in `apps/server/src/files/api.ts` from drizzle to `effect/sql`:
  `SELECT kind, mime, name FROM media_items WHERE archive_owner = ? AND chat_jid = ?
  AND url = ? AND deleted = false AND kind <> 'link' LIMIT 1`, keeping the same five
  conditions and `LIMIT 1`.
- Replaced `FilesItemRow` (`typeof mediaItems.$inferSelect`) with the local shape
  `{ kind: string; mime: string | null; name: string | null }`, matching
  `schema.ts:1394-1420` nullability. Only `kind`, `mime` and `name` are selected, so
  the `bigint` `at_micros` never comes back as a string.
- Dropped the value imports from `drizzle-orm` (`and, eq, ne`) and `db/schema`
  (`mediaItems`). The file now imports `SqlClient` from `effect/sql` and
  `sqlRuntimeFor` from `../effect/sql`.
- `findFileRow` keeps its signature (`db: ServerDatabase`, returns
  `Promise<FilesItemRow | undefined>`) and runs the effect through
  `sqlRuntimeFor(db).runPromise(...)`, so callers and the `Effect.catchDefect`
  handling at lines 224/258 are unchanged. No test file was touched.

### Files changed
- `apps/server/src/files/api.ts`
- `work/T-0625-effect-sql-files-lookup.md`

### Commands and results
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/files` →
  `Test Files 1 passed (1)`, `Tests 14 passed (14)`.
- `pnpm gate` (repo root) → `gate: 2 changed file(s) against main`;
  `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS tests @zilar/server`; `scope: every changed file is inside the Allowed files`;
  `GATE PASS`.

### Deviations / notes
- None. `apps/server/src/files/routes.test.ts` is unchanged and green (it seeds rows
  through the drizzle handle, which the migration recipe §(a) step 7 allows).

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet head is ff768c00, the current HEAD.
- **Lead check of the diff:**
  - the same five conditions and `LIMIT 1`;
  - only `kind`, `mime` and `name` are selected, so the `bigint` column is never read;
  - no drizzle import is left.
- **Nit, for the next cleanup task:** the stale header comment at `files/api.ts:5` still mentions the drizzle read.

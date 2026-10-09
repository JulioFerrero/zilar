---
id: T-0710
title: "tests off drizzle (stickers): replace every drizzle query in stickers/telegram-import-routes.test.ts, stickers/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0710-stickers-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0710: stickers tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the stickers folder.

### Verified facts (do not re-derive)
- `apps/server/src/stickers/telegram-import-routes.test.ts` (728 lines): drizzle at lines 5, 7, 8, 203, 320, 384, 424, 444, 476, 495, 522, 668, 725.
- `apps/server/src/stickers/routes.test.ts` (761 lines): drizzle at lines 6, 380, 388.
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
`apps/server/src/stickers/telegram-import-routes.test.ts`, `apps/server/src/stickers/routes.test.ts`, `work/T-0710-stickers-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/telegram-import-routes.test.ts src/stickers/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/stickers/telegram-import-routes.test.ts apps/server/src/stickers/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/stickers/telegram-import-routes.test.ts`: every drizzle seed and assertion read is now `testSql(context)(Effect.gen(...))` with `sql<Row>` raw SQL on snake_case columns. The 117-row, 114-row and 2-row seeds use `sql.insert([...])` with snake_case keys. Added local row types `StickerIdRow { id }` and `AuditRow { action, detail }`. Removed the `drizzle-orm`, `../db/schema` and `auditLog`/`stickers`/`eq` imports. `context.db` is still passed to module functions, untouched.
- `apps/server/src/stickers/routes.test.ts`: the 199-iteration panel seed (sticker_packs + user_sticker_packs) uses `testSql` and `sql.insert`. Removed the `../db/schema` import.
- Columns with a SQL default (`created_at`, `updated_at`, `added_at`, which were `new Date()` in the drizzle seeds) are left out, as the spec allows. `visibility` is still passed explicitly. The DB default is `now()`, so the stored values are the same kind of "now" but not the same JS `Date` instance. No assertion reads those columns.
- No Allowed file other than the two tests and this task file was touched.

### Commands and results
- `pnpm install`: exit 0 ("Done in 40.6s").
- Before the change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/stickers/telegram-import-routes.test.ts src/stickers/routes.test.ts`: Test Files 2 passed (2), Tests 50 passed (50).
- After the change, same command: Test Files 2 passed (2), Tests 50 passed (50).
- `git grep -n "drizzle-orm\|db/schema" -- <the two files>`: no output, exit 1 (no match). Acceptance met.
- `pnpm exec prettier --write` on both files: both "unchanged".
- `pnpm gate` from `/Users/julio/personal-projects/zilar-T-0710`: `GATE PASS`. Steps: install (frozen) PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/server PASS. `scope: every changed file is inside the Allowed files`. "2 changed file(s) against main".

### Problems / open questions
- None blocking. I ran the two sticker test files myself; the gate's `tests @zilar/server` step (20.5s) ran its own nearest-test selection, and I did not check which files it included.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.4 min). The lead reviewed the diff directly. The sticker pack, user pack and sticker seeds use `sql.insert` with snake_case keys. Timestamps fall back to the DB `now()` default, which no assertion reads. There are 50 tests before and after, no drizzle import is left, and the gate passed.

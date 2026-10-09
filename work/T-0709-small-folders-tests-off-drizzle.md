---
id: T-0709
title: "tests off drizzle (avatars + chat-folders + connections + files): replace every drizzle query in avatars/routes.test.ts, chat-folders/chat-folders.test.ts, connections/routes.test.ts, files/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0709-small-folders-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0709: avatars + chat-folders + connections + files tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the avatars + chat-folders + connections + files folder.

### Verified facts (do not re-derive)
- `apps/server/src/avatars/routes.test.ts` (590 lines): drizzle at lines 7, 196, 205, 217, 359, 375, 391, 419, 431, 438, 453, 465.
- `apps/server/src/chat-folders/chat-folders.test.ts` (417 lines): drizzle at lines 2, 113, 220, 364.
- `apps/server/src/connections/routes.test.ts` (510 lines): drizzle at lines 4, 131, 170, 323, 364.
- `apps/server/src/files/routes.test.ts` (608 lines): drizzle at lines 5, 423, 464, 476, 582.
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
`apps/server/src/avatars/routes.test.ts`, `apps/server/src/chat-folders/chat-folders.test.ts`, `apps/server/src/connections/routes.test.ts`, `apps/server/src/files/routes.test.ts`, `work/T-0709-small-folders-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars/routes.test.ts src/chat-folders/chat-folders.test.ts src/connections/routes.test.ts src/files/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/avatars/routes.test.ts apps/server/src/chat-folders/chat-folders.test.ts apps/server/src/connections/routes.test.ts apps/server/src/files/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Replaced every drizzle query in the four test files with `testSql(context)(...)` +
`effect/sql`, and dropped the `drizzle-orm` / `../db/schema` imports (there were no
dynamic `import('../db/schema')` calls). `db: context.db` passes to modules were left
untouched.

- `apps/server/src/avatars/routes.test.ts`: added `Effect`/`SqlClient` imports and
  `testSql`. `addAi` now seeds `provider_connections`, `ais` and `ai_limits` with one
  `testSql` effect using `sql.insert` (snake_case keys; omitted the nullable `label`
  that drizzle set to `null`, so it is still `null`). Added a local `storedAvatars()`
  helper (`SELECT id, storage_key FROM avatars`) used by the six "nothing stored /
  exactly one row" assertions and by the replace/race tests that read `id` and
  `storageKey`.
- `apps/server/src/chat-folders/chat-folders.test.ts`: three reads converted —
  `SELECT user_id FROM chat_folder_seeds` (length 1), `SELECT id FROM chat_folders`
  (length 2), `SELECT user_id FROM chat_folders` (per-user filter).
- `apps/server/src/connections/routes.test.ts`: two `SELECT encrypted_key FROM
  provider_connections` reads (the encrypted-at-rest assertions) and one `SELECT id
  FROM provider_connections` emptiness read; the in-use-AI seed now inserts into `ais`
  via `sql.insert`.
- `apps/server/src/files/routes.test.ts`: added a local `seedMediaItem(own, peer,
  messageId, name)` helper inserting into `media_items` via `sql.insert` (same values,
  `at_micros` bound as the number `at(...)` already returned), replacing the three
  duplicated drizzle inserts; the pre-index emptiness check reads `SELECT id FROM
  media_items`.

Result columns come back camelCased, so the row types use `storageKey`, `encryptedKey`,
`userId`, etc., while the SQL names the snake_case columns. No assertion meaning was
changed; `it` counts are unchanged in every file.

### Files changed

- `apps/server/src/avatars/routes.test.ts`
- `apps/server/src/chat-folders/chat-folders.test.ts`
- `apps/server/src/connections/routes.test.ts`
- `apps/server/src/files/routes.test.ts`
- `work/T-0709-small-folders-tests-off-drizzle.md`

### Commands and results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/avatars/routes.test.ts src/chat-folders/chat-folders.test.ts src/connections/routes.test.ts src/files/routes.test.ts`
  → Test Files 4 passed (4); Tests 58 passed (58).
- Test counts before vs after (counted `it(` in the four files at HEAD and checked
  against the run): before 18+10+16+14 = 58; after 58 passed. Same count.
- `git grep -n "drizzle-orm\|db/schema" -- <the four files>` → no matches (exit 1).
- `pnpm gate` (repo root):
  - `PASS install (frozen) (3.0s)`
  - `PASS format (36.8s)`
  - `PASS lint (1.1s)`
  - `PASS typecheck (4.7s)`
  - `PASS tests @zilar/server (44.2s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- First gate run failed typecheck with TS4104 (`sql<Row>` returns a readonly array):
  fixed by typing `storedAvatars()` as `ReadonlyArray<...>`; the re-run passed.

### Deviations / notes

- In `avatars` I dropped the explicit `label: null` from the `provider_connections`
  insert (the column is nullable with no SQL default, so the stored value is still
  `null`), and relied on the SQL defaults for `status`/`created_at`/`updated_at`, as
  the task's column note allows.
- No open questions; nothing blocked.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head e02741c7). The avatars, chat-folders, connections and files tests are on `testSql`.

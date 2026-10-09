---
id: T-0702
title: "tests off drizzle (push): replace every drizzle query in push/routes.test.ts, push/rooms.test.ts, push/service.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0702-push-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0702: push tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the push folder.

### Verified facts (do not re-derive)
- `apps/server/src/push/routes.test.ts` (401 lines): drizzle at lines 1, 145.
- `apps/server/src/push/rooms.test.ts` (273 lines): drizzle at lines 12, 39, 62, 68, 72, 84, 96, 164.
- `apps/server/src/push/service.test.ts` (675 lines): drizzle at lines 11, 157, 163, 167, 204, 210, 214, 242, 268, 274, 279, 291, 303, 523, 560, 566, 570, 582, 594, 609.
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
`apps/server/src/push/routes.test.ts`, `apps/server/src/push/rooms.test.ts`, `apps/server/src/push/service.test.ts`, `work/T-0702-push-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/routes.test.ts src/push/rooms.test.ts src/push/service.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/push/routes.test.ts apps/server/src/push/rooms.test.ts apps/server/src/push/service.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/server/src/push/routes.test.ts`: dropped the `drizzle-orm` import; the `DROP TABLE group_members` step now runs through `testSql(context)` with `effect/sql`.
- `apps/server/src/push/rooms.test.ts`: dropped the `../db/schema` and `drizzle-orm` imports (including the dynamic `import('drizzle-orm')`). `topicRow` reads `SELECT * FROM topics WHERE room_localpart = ...` into `sql<TopicRow>`, the same pattern as `getTopic` in `apps/server/src/topics/access.ts:100`, because `syncTopicRoom` needs the full row. The seed inserts in `beforeEach` and the archive update became raw SQL. The archive update uses `now()` where drizzle used `new Date()`.
- `apps/server/src/push/service.test.ts`: dropped the `../db/schema` import. All seed inserts (groups, group_members, topics, topic_members, chat_prefs) are raw SQL in `testSql(context)` blocks. The two `chat_prefs` mute rows take `muted_until` as the ISO literal `'2026-10-30T00:00:00Z'`, which is the same instant drizzle wrote. `updated_at` and `pinned_at` were left out, since they have SQL defaults or are NULL.
- Checked the column names against `apps/server/src/db/schema.ts`. Among the five tables, only `$defaultFn` in the file is on `chatFolders`, so none of these inserts needed a JS-filled value.
- Left alone: `context.db` passed to module functions (`saveDevice`, `devicesForUser`, `setShowPreviewsForUser`, `deviceByNode`, `createPushTestTables`, `syncTopicRoom`, `handleIncomingPush` deps).

**Tests**
- Before any change, `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push/routes.test.ts src/push/rooms.test.ts src/push/service.test.ts`: 3 files passed, 34 tests passed.
- After the change, same command: 3 files passed, 34 tests passed.
- `rooms.test.ts` on its own after the first conversion: 5 passed (before the final constant clean-up, which only changed `${'...'}` to literal SQL).
- Acceptance grep `git grep -n "drizzle-orm\|db/schema" -- <the three files>`: no output (exit 1).

**`pnpm gate` (from /Users/julio/personal-projects/zilar-T-0702, run once)**
```
PASS  install (frozen)  (2.1s)
PASS  format  (36.6s)
PASS  lint  (1.4s)
PASS  typecheck  (5.6s)
PASS  tests @zilar/server  (26.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```
Changed files: the three test files and this task file.

**Problems / deviations**
- None blocking. Nothing outside the Allowed files was touched.
- Unsure: `now()` for the archive timestamp and the ISO literal for `muted_until` replace the JS `Date` values. They store the same kind of value, and the tests that read them pass, but a reviewer may prefer JS-side dates.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.2 min). The lead reviewed the diff directly. The push seeds (groups, members, topics, chat prefs) are raw inserts through `testSql` with explicit ids. `now()` and the ISO literal are fine for these timestamps. There are 34 tests before and after, and the gate passed.

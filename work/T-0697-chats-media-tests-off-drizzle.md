---
id: T-0697
title: "tests off drizzle (chats + media): replace every drizzle query in chats/chats.test.ts, media/indexer.test.ts, media/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0697-chats-media-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0697: chats + media tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the chats + media folder.

### Verified facts (do not re-derive)
- `apps/server/src/chats/chats.test.ts` (242 lines): drizzle at lines 2, 4, 72, 82, 94, 102, 157.
- `apps/server/src/media/indexer.test.ts` (544 lines): drizzle at lines 3, 4, 289, 328, 358, 424, 427.
- `apps/server/src/media/routes.test.ts` (570 lines): drizzle at lines 3, 4, 501.
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
`apps/server/src/chats/chats.test.ts`, `apps/server/src/media/indexer.test.ts`, `apps/server/src/media/routes.test.ts`, `work/T-0697-chats-media-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/chats.test.ts src/media/indexer.test.ts src/media/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/chats/chats.test.ts apps/server/src/media/indexer.test.ts apps/server/src/media/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What changed
- `apps/server/src/chats/chats.test.ts`: drizzle imports removed. `addAi` inserts into `provider_connections`, `ais` and `ai_limits` through `testSql(context)` with `sql.insert` (snake_case keys). The group-row read selects `room_localpart` into `roomLocalpart`. The background set becomes `UPDATE groups SET background_preset = 'navy' WHERE id = ...`.
- `apps/server/src/media/indexer.test.ts`: drizzle imports removed. `rowsForChat()` selects the 8 columns the assertions read (`message_id, kind, sender_jid, ref, link_url, link_host, deleted, at_micros::float8`). The cursor read and reset use `media_index_state`. Two room reads select `message_id` only. `db: context.db` in the two `indexChat` calls is unchanged.
- `apps/server/src/media/routes.test.ts`: drizzle imports removed. The group-row read is the same as in chats.
- `work/T-0697-chats-media-tests-off-drizzle.md`: status and this Report.
- Assertions, rows and values are unchanged. Column names were checked against `apps/server/src/db/schema.ts` (`provider_connections`, `ais`, `ai_limits`, `groups`, `media_items`, `media_index_state`). Every NOT NULL column without a SQL default is provided.

### Test counts
- Before (`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot` on the 3 files): 3 files, 33 passed.
- After the drizzle removal (before Prettier): 3 files, 33 passed.
- After Prettier, the gate's `tests @zilar/server` step passed. The gate does not print a count.

### Commands and real results
- `pnpm install`: done, 31.5s.
- Acceptance grep `git grep -n "drizzle-orm\|db/schema" -- <3 files>`: no output (exit 1).
- First `pnpm gate`: FAIL at `format` only. Prettier flagged the 3 test files (long template-literal lines). Fixed with `pnpm exec prettier --write` on those 3 files only.
- Final `pnpm gate`: exit 0.
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Deviations and notes
- `at_micros` and `indexed_through_micros` are bigint with `mode: 'number'`. Production uses `@effect/sql-pg`, which returns int8 as a string, and there is no custom parser (`apps/server/src/effect/sql.ts`). So the reads use `::float8` to match what drizzle returned. The values are microsecond timestamps, well inside 2^53, so no precision is lost.
- The spec says `schema.ts` has `$defaultFn` / `$onUpdate`. `grep` finds neither in the current file, so no raw insert needed a JS-side value.
- Scratch files: none left in the worktree. The gate log went to the scratchpad.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 11 min). The lead reviewed the diff directly. The chats seeds use `sql.insert` with snake_case keys. The media reads cast the bigint micros to `::float8`, which is exact below 2^53 and keeps the JS numbers drizzle gave. There are 33 tests before and after, and the gate passed.

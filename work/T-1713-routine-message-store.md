---
id: T-1713
title: "Routine live message, step 1 (plan docs/plan/routine-live-message.md tasks 1+2): migration 0068 adds routines.last_message_id + last_message_at (nullable, expand-only), RoutineRow gains them, and a new routines/message-store.ts loads, records and clears a routine's message id"
status: merged
milestone: M5
branch: task/T-1713-routine-message-store
model: auto
effort: default
depends_on: []
estimate: 35 min
---

# T-1713: Store a routine's message id

## Spec (written by Claude, do not edit)

### Why
Julio approved on 2026-10-16 that a routine posts one message and every later run edits it (`docs/design/mockups/routines/README.md`). This is the storage half of the plan `docs/plan/routine-live-message.md` (§2 tasks 1 and 2): the routine remembers the id of the message it posted.

### Facts (the lead read them on 2026-10-16)
- **Migrations** are hand-written SQL files in `apps/server/drizzle/`, picked up by name; the latest is `0067_routine_kind.sql`. Each statement ends with `--> statement-breakpoint`, and the file starts with `SET lock_timeout = '5s';--> statement-breakpoint`. T-1638 added 0067 with only the `.sql` file and the row type (commit `1234b2a59`).
- **`apps/server/src/db/rows-agents.ts:152-176`:** `RoutineRow`, ending `createdBy`, `createdAt`, `updatedAt`, `deletedAt`. The SQL client camelCases result names (plan §1(d), `apps/server/src/effect/sql.ts:39-41`), so `SELECT *` maps new columns with no query change.
- **The precedent for stamping a posted id on a row:** `ai_questions.message_id` (`apps/server/src/questions/service.ts:132-148`).
- **The routines test harness:** `createTestContext`, `testSql` (`../test-support`), and `seedAi` and `seedUser` (`../test-support/seed`), as used in `apps/server/src/routines/execute-prompt.test.ts:4-40`, which seeds a routine row with SQL (`seedPromptRoutine`, `:20` on).

### Steps
1. **New `apps/server/drizzle/0068_routine_last_message.sql`:**
   ```sql
   SET lock_timeout = '5s';--> statement-breakpoint
   ALTER TABLE "routines" ADD COLUMN "last_message_id" text;--> statement-breakpoint
   ALTER TABLE "routines" ADD COLUMN "last_message_at" timestamp with time zone;
   ```
   Match the type the other `routines` timestamp columns use; check `0023_*` and the file that created `last_run_at`.
2. **`rows-agents.ts`:** add `lastMessageId: string | null;` and `lastMessageAt: Date | null;` to `RoutineRow`, with a `// T-1713:` comment.
3. **New `apps/server/src/routines/message-store.ts`**, Effect SQL through `runSql`, the way `routines/queries.ts` does:
   - `loadRoutineMessage(db, routineId)` returns `{ messageId: string; at: Date } | null` (null when either column is null or the routine is deleted);
   - `recordRoutineMessage(db, routineId, messageId, at)` runs `UPDATE routines SET last_message_id, last_message_at, updated_at WHERE id = $routineId`;
   - `clearRoutineMessage(db, routineId)` sets both to NULL;
   - `clearRoutineMessageByTarget(db, messageId)` sets both to NULL `WHERE last_message_id = $messageId`.
4. **Test** (routines are billed AI runs): new `apps/server/src/routines/message-store.test.ts` on the real test database. Seed one prompt routine as `execute-prompt.test.ts` does, then check:
   - record, then load, returns the id and the time;
   - clear makes load return null;
   - clearing by target clears only the routine holding that id.
5. Wire nothing into runs yet; that's the next tasks.

### Allowed files
- `apps/server/drizzle/0068_routine_last_message.sql`
- `apps/server/src/db/rows-agents.ts`
- `apps/server/src/routines/message-store.ts`
- `apps/server/src/routines/message-store.test.ts`
- `work/T-1713-routine-message-store.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/routines/message-store.test.ts src/routines/execute-prompt.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- **Migration 0068** adds the two nullable columns.
- **`RoutineRow`** has them.
- **The store's four functions work** on the test database, and the new test passes.

---

## Report (written by the worker when done)

### What I did

- **`apps/server/drizzle/0068_routine_last_message.sql`:** new expand-only
  migration adding `last_message_id text` and `last_message_at timestamp with
  time zone` (both nullable), first line `SET lock_timeout = '5s';`. The
  timestamp type matches the other `routines` time columns in
  `0023_classy_lester.sql` (`last_run_at`/`created_at`/`updated_at`).
- **`apps/server/src/db/rows-agents.ts`:** `RoutineRow` gains
  `lastMessageId: string | null` and `lastMessageAt: Date | null`, with a
  `// T-1713:` comment. Placed after `lastStatus` next to the other last-run
  fields. No query change needed: `SELECT *`/`RETURNING *` map the new columns
  through the camelCasing client.
- **`apps/server/src/routines/message-store.ts`:** new module with the four
  functions, Effect SQL through `runSql`, mirroring `routines/queries.ts` and
  `routines/outcomes.ts`:
  - `loadRoutineMessage(db, routineId)` returns `{ messageId, at } | null`
    (`null` when either column is null or the routine is deleted);
  - `recordRoutineMessage(db, routineId, messageId, at)` sets both columns plus
    `updated_at`;
  - `clearRoutineMessage(db, routineId)` sets both columns to NULL;
  - `clearRoutineMessageByTarget(db, messageId)` sets both columns to NULL
    where `last_message_id` matches.
- **`apps/server/src/routines/message-store.test.ts`:** new test on the real
  PGlite test database, seeding prompt routines the way
  `execute-prompt.test.ts` does. Three cases: record→load returns the id and
  time; clear→load returns null; clear-by-target clears only the routine that
  holds the id (two routines seeded, the other keeps its message).
- Nothing is wired into runs yet, as the spec asks (next tasks).

### Checks run

Single tests (AGENTS.md form, worker cap + dot reporter):

```
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot \
  src/routines/message-store.test.ts src/routines/execute-prompt.test.ts
→ Test Files 2 passed (2); Tests 12 passed (12)
```

`pnpm gate` (from the repo root), summary lines:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (1.1s)
PASS  lint  (1.0s)
PASS  typecheck  (3.3s)
PASS  effect  (0.6s)
PASS  tests @zilar/server  (6.8s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- Spec deviations: none in what the functions do. One small interpretation: the
  spec lists `updated_at` only for `recordRoutineMessage`, so `clearRoutineMessage`
  and `clearRoutineMessageByTarget` set exactly the two message columns to NULL
  and leave `updated_at` alone, as the spec says ("sets both to NULL").
  `recordRoutineMessage` uses the passed `at` for both `last_message_at` and
  `updated_at`, matching the existing routines code (`outcomes.ts` writes
  `updated_at = ${at}`), rather than the `now()` shorthand in the plan text.
- The test's three cases match the spec's three bullets; I did not add a
  deleted-routine case since the spec did not ask for one (the code does guard
  on `deleted_at IS NULL`).
- No new dependencies. No files outside the Allowed list were touched
  (`git status`: the three new files plus `rows-agents.ts` and this task file).

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean, 1 nit (one branch untested), accepted.
- **The change:**
  - migration 0068 adds two nullable columns (expand-only, `lock_timeout` first);
  - `RoutineRow` gains them;
  - `message-store.ts` has the four helpers, each scoped by the routine id or the stored message id.
- **The tests:** the lead ran `message-store.test.ts` on the test database in the worktree: 3 tests passed.
- **Next:** T-1714 wires this store into the send path.

---
id: T-0695
title: "H1: add testSql(context) to test-support.ts (runs an Effect on the test db's effect/sql runtime) and prove it by moving pins/pins.test.ts off drizzle (T3 of the drizzle-removal plan)"
status: merged
milestone: M5
branch: task/T-0695-test-sql-helper
model: auto
effort: low
depends_on: [T-0691]
estimate: 0.1 day
---

# T-0695: the testSql helper (H1), proven on pins

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `docs/audit/drizzle-removal-plan.md` (T-0691) moves the 56+ test files off drizzle through one helper, H1 §2.1. It lands first, with one small folder as proof (T3, pins).

### Verified facts (do not re-derive)
- **`apps/server/src/test-support.ts`:**
  - line 9 imports `registerSqlRuntime` from `./effect/sql`;
  - `createTestContext` (line 304) registers the runtime for `context.db` at line 310;
  - `TestContext` is at line 242.
- **`sqlRuntimeFor(db)`** (`apps/server/src/effect/sql.ts:98`) returns the registered `ManagedRuntime`, and its `runPromise(effect)` runs an Effect that needs `SqlClient.SqlClient`. The import lines to copy are `apps/server/src/topics/service.ts:2-3`: `import { Effect } from 'effect'; import { SqlClient, type SqlError } from 'effect/sql';`.
- **Results are camelCased** (`transformResultNames`, `effect/sql.ts:56`), and the SQL names snake_case columns.
- **`apps/server/src/pins/pins.test.ts`** uses drizzle at:
  - line 2 (`and`, `eq`) and line 3 (`auditLog`, `groupMembers`, `pinnedMessages`, `topics`);
  - lines 183-193: an `UPDATE group_members SET role … WHERE group_id AND user_id` and an `UPDATE topics … WHERE id`; read the `set(...)` values there;
  - line 318: `select().from(pinnedMessages)`, where only the length is used;
  - line 340: `select().from(auditLog)`, where `action` and the other columns are read in that test; select only what it reads;
  - line 362: `select().from(pinnedMessages)`.

### What to build
1. **In `test-support.ts`,** add the helper from the plan §2.1:

   ```ts
   export function testSql(context: Pick<TestContext, 'db'>) {
     return <A>(effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>): Promise<A> =>
       sqlRuntimeFor(context.db).runPromise(effect);
   }
   ```

   Add a one-line comment, and import `sqlRuntimeFor` next to `registerSqlRuntime`. Nothing else in `test-support.ts` changes.
2. **In `pins/pins.test.ts`,** replace every drizzle query with `testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; … }))`, with the same rows, values and assertions. Remove the `drizzle-orm` and `../db/schema` imports. Give each select a small local row type when a test reads fields.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` §2 (lines 249-390), `apps/server/src/test-support.ts` (lines 1-30, 240-330), `apps/server/src/pins/pins.test.ts`.

### Allowed files
`apps/server/src/test-support.ts`, `apps/server/src/pins/pins.test.ts`, `work/T-0695-test-sql-helper.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/pins
pnpm gate
```

### Acceptance
- `pins/pins.test.ts` imports neither `drizzle-orm` nor `../db/schema`.
- The pins tests pass with the same test count.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/server/src/test-support.ts`: added `testSql(context)` (the task's version: the generic `<A>` sits on the returned runner) with a one-line comment, placed just before `createTestContext`. Imported `sqlRuntimeFor` next to `registerSqlRuntime`, and type-only imports of `Effect`, `SqlClient`, `SqlError`. Nothing else changed.
- `apps/server/src/pins/pins.test.ts`: every drizzle query is now `testSql(context)(Effect.gen(...))` with raw SQL and bound parameters. Removed the `drizzle-orm` and `../db/schema` imports. Local row types: `AuditRow` (action, subjectId, groupId, detail) and `PinRow` (chatJid). The two `UPDATE`s copy the `set` values from the old code (`role = 'admin'`, `created_by = member.id`) with the same `WHERE` keys.
- Count at pins.test.ts:318 uses `SELECT id FROM pinned_messages` and keeps `toHaveLength(20)`, instead of `count(*)`, so the assertion is unchanged.
- Test file names checked against `apps/server/src/db/schema.ts`: `group_members` (group_id, user_id, role), `topics` (created_by), `pinned_messages` (chat_jid), `audit_log` (action, subject_id, group_id, detail). `detail` is jsonb and comes back as a parsed object (the groupId assertions for the private-topic pin pass, which relies on it).

**Commands and results**
- `pnpm install`: exit 0.
- `grep -n "drizzle\|db/schema\|context\.db\|eq(\|and(" apps/server/src/pins/pins.test.ts`: no matches.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/pins`: 1 file passed, 10 tests passed (same count as before).
- `pnpm gate` (from the worktree root, cwd checked): exit 0.

**Gate summary lines**
```
gate: 3 changed file(s) against main
PASS  install (frozen)  (2.5s)
PASS  format  (30.6s)
PASS  lint  (1.8s)
PASS  typecheck  (5.7s)
PASS  tests @zilar/server  (19.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

**Single tests run:** only `src/pins` (above). No other tests run by me.

**Deviations:** none from the task spec. The plan's §2.1 snippet put the generic on `testSql`; I followed the task's version instead.

**Open questions:** none. `detail` jsonb parsing is verified only on PGlite (the test runtime), which is the only runtime that exists in tests.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 2.6 min). The lead reviewed the diff directly.
- **Result:** `testSql(context)` is exactly the plan §2.1 helper. The pins tests now use it for the two updates and three reads, select only the columns they read, and import no drizzle. The gate passed.

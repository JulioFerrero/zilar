---
id: T-0695
title: "H1: add testSql(context) to test-support.ts (runs an Effect on the test db's effect/sql runtime) and prove it by moving pins/pins.test.ts off drizzle (T3 of the drizzle-removal plan)"
status: todo
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

## Review (written by Claude)

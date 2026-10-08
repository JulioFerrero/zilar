---
id: T-0674
title: "effect/sql: run the push test-table DDL helper (push/test-tables.ts) on the effect/sql client instead of drizzle db.execute"
status: todo
milestone: M5
branch: task/T-0674-push-test-tables-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0674: push test-table helper on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `push/test-tables.ts` is a 34-line test helper that still calls drizzle's `db.execute`.

### Verified facts (do not re-derive)
- **`apps/server/src/push/test-tables.ts`:** `createPushTestTables(db)` runs three `db.execute(sql\`…\`)` DDL statements, all `IF NOT EXISTS`:
  - the `push_subscriptions` table;
  - its `push_subscriptions_user_idx` index;
  - the `push_settings` table.
  - `sql` comes from `drizzle-orm` (line 1).
- **Callers** (each with a test db): `push/component.test.ts:19`, `push/rooms.test.ts:19`, `push/routes.test.ts:13`, `push/service.effect.test.ts:15`, `push/service.test.ts:18`.
- **The runtime:** `sqlRuntimeFor(db)` in `apps/server/src/effect/sql.ts:98`. A statement with no parameters is written as `` sql`…` `` on `SqlClient.SqlClient`.

### What to build
1. **Rewrite `createPushTestTables(db)`** to run the same three statements, in order and with the exact DDL text, through `sqlRuntimeFor(db).runPromise(Effect.gen(…))`.
2. **Drop the drizzle import.** The signature does not change.

### Read first
`AGENTS.md`, `apps/server/src/push/test-tables.ts`, `apps/server/src/effect/sql.ts` (lines 85-110).

### Allowed files
`apps/server/src/push/test-tables.ts`, `work/T-0674-push-test-tables-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/push
pnpm gate
```

### Acceptance
- `push/test-tables.ts` has no drizzle import.
- The push tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

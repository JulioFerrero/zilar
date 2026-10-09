---
id: T-0693
title: "effect/sql: app.ts isDatabaseUp runs `select 1` through sqlRuntimeFor (drop the drizzle `sql` import); app.test.ts down-database test fakes sqlRuntimeFor instead of spying on db.execute"
status: todo
milestone: M5
branch: task/T-0693-health-check-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0693: the health check on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `app.ts` uses drizzle only for the `/health` database probe.

### Verified facts (do not re-derive)
- **`apps/server/src/app.ts:1`:** `import { sql } from 'drizzle-orm';`
- **`app.ts:667-674`:** `isDatabaseUp(db)` runs `withTimeout(Promise.resolve(db.execute(sql\`select 1\`)), DB_HEALTH_TIMEOUT_MS)` and returns true, or false on any error. `withTimeout` is at `app.ts:676`.
- **`app.ts:249`** calls `registerSqlRuntime(db, config.DATABASE_URL)` before anything else. Import `sqlRuntimeFor` from the same `./effect/sql` module.
- **`apps/server/src/app.test.ts:64-70`** ("reports a down database when the health query fails") does `vi.spyOn(context.db, 'execute').mockRejectedValue(new Error('connection refused'))`, which will no longer reach the probe.
- **The proven failure-injection pattern** is `apps/server/src/setup/routes.test.ts:25-30` (T-0675): a partial `vi.mock('../effect/sql', async (importOriginal) => ({ ...actual, sqlRuntimeFor: vi.fn(actual.sqlRuntimeFor) }))`, then `vi.mocked(sqlRuntimeFor).mockReturnValueOnce({ runPromise: () => Promise.reject(err) } as never)` right before the call.

### What to build
1. **In `app.ts`:**
   - `isDatabaseUp` runs `` sqlRuntimeFor(db).runPromise(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; yield* sql`select 1`; })) `` inside the same `withTimeout`, and returns the same booleans;
   - remove the drizzle import;
   - import `Effect` and `SqlClient` the way other modules do (copy the import lines from `apps/server/src/topics/service.ts`).
2. **In `app.test.ts`:**
   - add the partial `vi.mock('./effect/sql', …)` at the top;
   - in the down-database test, build the app first, then `mockReturnValueOnce` a rejecting runtime just before `request('/health')`. If the request makes other `sqlRuntimeFor` calls first, use `mockImplementation` and restore it after.
   - The other tests in the file must pass unchanged.

### Read first
`AGENTS.md`, `apps/server/src/app.ts` (lines 1-60, 240-252, 605-690), `apps/server/src/app.test.ts` (lines 1-80), `apps/server/src/setup/routes.test.ts` (lines 1-40).

### Allowed files
`apps/server/src/app.ts`, `apps/server/src/app.test.ts`, `work/T-0693-health-check-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/app.test
pnpm gate
```

### Acceptance
- `app.ts` has no drizzle import.
- The health tests pass: healthy gives 200 `db: 'ok'`, and down gives 503 `db: 'down'`.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

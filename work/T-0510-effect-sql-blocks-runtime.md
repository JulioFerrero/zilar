---
id: T-0510
title: "Effect C1: blocks service on effect/sql (same lock order, same answers) + the effect/sql runtime registered once in createApp/test context and disposed on shutdown"
status: todo
milestone: M5
branch: task/T-0510-effect-sql-blocks-runtime
model: auto
effort: low
depends_on: [T-0496]
estimate: 0.5 day
---

# T-0510: blocks on effect/sql, plus runtime wiring

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle. T-0496 (merged) moved `pins` and wrote the recipe in `docs/audit/effect-sql-migration.md` §(a). This is the first bulk module.

It also fixes the spike's follow-up: today the runtime is registered only inside `createPinsRoutes`, so `sqlRuntimeFor(db)` throws for any db that never went through pins.

### Verified facts (do not re-derive)
- **`apps/server/src/effect/sql.ts`** (T-0496):
  - `sqlLayerFor(db, databaseUrl)`: PGlite (`PgliteClient.layer({ liveClient: db.$client })`) or a pg pool of `SQL_POOL_MAX` = 10;
  - **`registerSqlRuntime(db, databaseUrl)`** memoizes a `ManagedRuntime` per drizzle handle in a `WeakMap`;
  - **`sqlRuntimeFor(db)`** throws `'No effect/sql runtime registered for this database'` if none is registered;
  - `snakeToCamel` row names.
- **`apps/server/src/pins/routes.ts`** calls `registerSqlRuntime(deps.db, deps.config.DATABASE_URL)` (T-0496). `apps/server/src/pins/service.ts` is the worked example (`sqlRuntimeFor(deps.db).runPromise(effect)`, `sql.withTransaction`, the advisory lock as raw SQL, `SqlError` `UniqueViolation` mapped to 409 and everything else to 503).
- **`apps/server/src/app.ts`:** `createApp({ db, config, … })` from line 207.
- **`apps/server/src/test-support.ts`:** `createTestContext` (line 303) and `testApp(context)` (line 344), which calls `createApp`.
- **`apps/server/src/index.ts`:** `shutdown(signal)` (from line 497) closes the server, `runnerHub`, `pushComponent`, `gateway`, `approvalsSweeper`, `recoveryStuck` and `routineScheduler`, then `await close()` (the drizzle client) and `process.exit(0)`. **The effect/sql pool is never disposed today.**
- **`apps/server/src/blocks/service.ts`** (193 lines, the only drizzle file in `blocks/`):
  - `MAX_BLOCK_LIST_ROWS = 500`;
  - `isDmBlocked` (line 53), imported by `files/routes.ts:7` and `media/routes.ts:7`;
  - **`blockUser`** (line 85): **a transaction that takes advisory locks in a fixed order shared with contact-request creation.** Read its comment (lines 83-100) and keep the lock keys and order exactly;
  - `unblockUser` (146) and `listBlockedUsers` (165).
  
  Tests: `apps/server/src/blocks/blocks.test.ts`, plus `contact-requests.test.ts` (it covers block and request interplay).
- **PGlite caution:** in tests, drizzle and effect/sql share **one** PGlite connection (`liveClient`). An effect/sql transaction and a drizzle transaction interleaving on that one connection could mix their boundaries. `contact-requests/service.ts` stays on drizzle in this task. If a test that runs a block and a contact request concurrently fails, report BLOCKED with the test name; do not change the test.

### What to build
1. **Runtime wiring:**
   - in `createApp` (`app.ts`), call `registerSqlRuntime(db, config.DATABASE_URL)` once, at the top;
   - remove the call from `apps/server/src/pins/routes.ts`; it is now redundant. Keep it there instead if removing it breaks a pins test that builds routes without `createApp`, and say so;
   - in `index.ts` `shutdown`, dispose the runtime (`sqlRuntimeFor(db).dispose()` or a small exported `disposeSqlRuntime(db)` in `effect/sql.ts`) **before** `await close()`.
2. **`blocks/service.ts` on effect/sql,** following the pins recipe:
   - the same exported functions, signatures and return values;
   - `withTransaction` keeps the same advisory lock statements in the same order;
   - the same `HttpError`s;
   - no drizzle imports left in this file.
3. **Tests:** `blocks.test.ts`, `contact-requests.test.ts`, `pins.test.ts`, and the files and media route tests pass **unchanged**. Add `apps/server/src/effect/sql-runtime.test.ts` covering:
   - after `createApp` on a fresh test context, `sqlRuntimeFor(db)` does not throw;
   - the dispose helper works and is idempotent.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/effect/sql.ts`, `apps/server/src/pins/service.ts`, `apps/server/src/pins/routes.ts`, `apps/server/src/blocks/service.ts`, `apps/server/src/app.ts:200-260`, `apps/server/src/index.ts:490-540`.

### Allowed files
`apps/server/src/blocks/service.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/effect/sql-runtime.test.ts`, `apps/server/src/app.ts`, `apps/server/src/pins/routes.ts`, `apps/server/src/index.ts`, `work/T-0510-effect-sql-blocks-runtime.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot blocks contact-requests pins src/effect
pnpm gate
```

### Acceptance
- The SQL runtime is registered in `createApp` and disposed on shutdown.
- `blocks` runs on effect/sql with the same lock order and answers.
- The listed tests are unchanged and green, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

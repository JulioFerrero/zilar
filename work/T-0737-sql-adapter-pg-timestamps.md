---
id: T-0737
title: "D2 prep: the better-auth sql adapter's utcTimestamp read fix is PGlite-only (on real pg, @effect/sql-pg already reads `timestamp` as UTC fields, so it would shift by the host offset); add a gated real-Postgres test that runs the adapter + drizzle cross-reads under a non-UTC TZ"
status: merged
milestone: M5
branch: task/T-0737-sql-adapter-pg-timestamps
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0737: correct timestamps on real Postgres for the auth adapter

## Spec (written by Claude, do not edit)

### Why
The D2 switch moves login (`apps/server/src/auth/auth.ts`) from `drizzleAdapter` onto the effect/sql adapter built in T-0690 (`apps/server/src/auth/sql-adapter.ts`). Its review left one open question: do auth timestamps round-trip correctly on production `pg`? The lead read the driver source, and the answer is "not on a non-UTC host". This task fixes that and proves it on a real Postgres **before** Julio decides on D2. **`auth.ts` does not change.**

### Verified facts (do not re-derive)
- **`apps/server/src/auth/sql-adapter.ts`:**
  - `utcTimestamp` (lines 171-187) rebuilds a `Date` from its **local** components as UTC. Its comment says PGlite reads a `timestamp` back as local time;
  - `normalizeRow` (line 189) applies it to every `date` field of every row, on every driver (call sites at lines 215, 231, 254 and 293).
- **`@effect/sql-pg` 4.0.2** (`apps/server/node_modules/@effect/sql-pg/dist/PgTypes.js:23-27`) says: "The `timestamp` codec maps wall-clock fields to UTC fields of a `Date`. Date parameters bind as `timestamptz`, so inserting one into a `timestamp` column applies the session `TimeZone`."
  - So on real pg the read is already UTC, the same as drizzle's `+0000` parse;
  - `utcTimestamp` would then shift every value by the host offset on any host whose `TZ` is not UTC (Julio's Mac is UTC+2);
  - writes store the UTC wall clock only while the Postgres session `TimeZone` is UTC.
- **The dev Postgres** (docker container `zilar-dev-postgres-1`, `DATABASE_URL` in `apps/server/.env`) reports `SHOW TimeZone` = `Etc/UTC`.
- **`isPgliteDatabase(db)`** is at `apps/server/src/effect/sql.ts:41`.
- **The gated-test pattern** is `apps/server/src/ais/integration.test.ts`: an env flag turns the test on, and it is skipped otherwise, so the gate stays offline.

### What to build
1. **`sql-adapter.ts`:** apply the `utcTimestamp` read correction only when `isPgliteDatabase(db)`. On real pg, rows pass through unchanged. Update the comment to say why, citing the `PgTypes.js` lines above. Also make writes independent of the session time zone: bind auth `date` values so that a `timestamp` column stores the UTC wall clock whatever the session `TimeZone` is. For example, send them as `${value.toISOString()}::timestamptz AT TIME ZONE 'UTC'`, or, preferably, use the driver's own helper `timestamp(value)`, exported by `@effect/sql-pg` (`PgTypes.d.ts:480`, `export declare const timestamp: (value: Date | number | null) => Parameter`), for real pg only. PGlite keeps its current binding. Keep PGlite behaviour exactly as it is today: the existing adapter tests must pass unchanged.
2. **Add `apps/server/src/auth/sql-adapter.pg.test.ts`,** skipped unless `ZILAR_PG_INTEGRATION=1`. It uses `DATABASE_URL`, which points at a **local** Postgres. Refuse to run if the host is not `127.0.0.1` or `localhost`. The test:
   - builds a real-pg `ServerDatabase` with `createDb` (`apps/server/src/db/client.ts:18`) and registers the effect/sql runtime for it;
   - sets `process.env.TZ = 'Europe/Madrid'` for the test, and restores it after;
   - **adapter round trip:** creates a `verification` row through the adapter with a known `expiresAt`, reads it back through the adapter, and expects the same instant;
   - **cross read, drizzle to adapter:** a row written through `drizzleAdapter` (as `auth.ts` does today) and read through the effect/sql adapter has the same instant, and so does the reverse;
   - deletes only the rows it created, by unique id.
3. **Run the gated test locally** against the dev docker Postgres, both with and without `TZ=Europe/Madrid`, and paste the results into the Report. The gate itself must stay offline, so the gated test is skipped there.

### Read first
`AGENTS.md`, `apps/server/src/auth/sql-adapter.ts`, `apps/server/src/auth/sql-adapter.test.ts`, `apps/server/src/auth/auth.ts` (lines 1-60), `apps/server/src/db/client.ts`, `apps/server/src/effect/sql.ts` (lines 1-110), `apps/server/node_modules/@effect/sql-pg/dist/PgTypes.d.ts`, `apps/server/src/ais/integration.test.ts` (lines 1-60).

### Allowed files
`apps/server/src/auth/sql-adapter.ts`, `apps/server/src/auth/sql-adapter.pg.test.ts`, `work/T-0737-sql-adapter-pg-timestamps.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test
ZILAR_PG_INTEGRATION=1 TZ=Europe/Madrid pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test
pnpm gate
```

### Acceptance
- The gated test passes on the local dev Postgres, both under `TZ=Europe/Madrid` and under UTC, with the output in the Report.
- The PGlite adapter tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What changed**
- `apps/server/src/auth/sql-adapter.ts`:
  - `normalizeRow` now returns rows unchanged on real pg; the `utcTimestamp` rebuild runs only for PGlite. The comment cites `@effect/sql-pg` 4.0.2 `dist/PgTypes.js:23-27`.
  - New `bindRow` helper: on real pg every `Date` value in an insert or update is bound with `PgTypes.timestamp(value)`, so the stored wall clock is the UTC wall clock whatever the session `TimeZone`. PGlite keeps the plain `Date` binding.
  - `normalizeRow` takes `db` as its first argument (4 call sites).
- `apps/server/src/auth/sql-adapter.pg.test.ts` (new): skipped unless `ZILAR_PG_INTEGRATION=1`; refuses any host other than `127.0.0.1` or `localhost`; pins `process.env.TZ` to `Europe/Madrid` (and asserts the -60 offset) and restores it after; three tests:
  - adapter round trip, plus the stored wall clock read as text (`2030-03-10 12:34:56.789`);
  - a row written by `drizzleAdapter` is read by the adapter at the same instant;
  - a row written by the adapter is read by `drizzleAdapter` at the same instant.
  - Rows are found by a random per-run `identifier`, recorded before each insert, and deleted by that identifier in `afterAll`.
- `work/T-0737-sql-adapter-pg-timestamps.md`: this Report and the status.
- `auth.ts` is unchanged.

**Commands and results**
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test`: 8 passed (1 file). PGlite adapter tests unchanged.
- `ZILAR_PG_INTEGRATION=1 TZ=Europe/Madrid pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test` against the local dev Postgres (`DATABASE_URL` from the main checkout's `.env`, passed through the environment): 3 passed (1 file).
- `ZILAR_PG_INTEGRATION=1 TZ=UTC pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test`: 3 passed (1 file).
- `docker exec zilar-dev-postgres-1 ... select count(*) from verification where identifier like 'pg-test-%'`: 0 after the runs.
- `pnpm exec prettier --write` on both changed files, then `pnpm exec tsc --noEmit` in `apps/server`: clean.
- `pnpm gate` (from the worktree root), last run:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Problems on the way (fixed)**
- My first gated runs failed on all three tests. The adapter factory assigns its own `id`, so I looked rows up by the id I passed, which matched nothing. I changed the test to use the returned id or the unique identifier. Those failed runs left 6 `pg-test-%` rows in `verification`. I deleted them with `DELETE ... WHERE identifier LIKE 'pg-test-%'` (6 before, 0 after). No other rows were touched.
- The first gate failed typecheck: `create<T>` did not include `identifier` in its type argument. Fixed; the gate passed on the next run.

**Not covered or unsure**
- The gated test pins `Europe/Madrid` itself, so the `TZ=UTC` run differs from the Madrid run only in the zone the process starts with. Both runs exercise Madrid inside the test.
- The write change is not proven by this test. The dev DB session `TimeZone` is `Etc/UTC`, so the stored wall clock is correct with or without `bindRow`. The read change is exercised: with the old read rebuild, the Madrid process would shift the value by an hour. I did not run a mutation check to confirm this.
- Where-clauses are not changed. A `Date` in a `where` (`lt`, `gt`, `=`, ...) still binds as `timestamptz`, so on a non-UTC session `TimeZone` a comparison against a `timestamp` column would use the session zone. The spec covers writes only. Decide if the lead wants that in this task or a follow-up.

**Blocked / needs a decision:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.6 min). The lead reviewed the diff directly.
- **Reads:** `normalizeRow` now runs on PGlite only. Real pg already reads `timestamp` as UTC fields (`PgTypes.js:23-27`).
- **Writes:** on pg, dates bind through `PgTypes.timestamp`, so the stored wall clock is UTC whatever the session time zone.
- **Tests:** the gated real-pg test passes against the local dev Postgres under `TZ=Europe/Madrid` (3 passed) and under UTC (3 passed). The 8 PGlite tests are unchanged, and the gate passed.
- **For the D2 switch task:** `Date` values in `WHERE` clauses still bind as `timestamptz`. This is harmless while the Postgres session `TimeZone` is UTC (dev: `Etc/UTC`), but bind them with `PgTypes.timestamp` too.

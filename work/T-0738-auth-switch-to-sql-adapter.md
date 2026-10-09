---
id: T-0738
title: "D2 switch (NEEDS JULIO'S GO): auth.ts uses effectSqlAdapter(db) instead of drizzleAdapter; the adapter's where-clause Date values bind with PgTypes.timestamp on real pg; auth tests pass on PGlite and the gated real-pg test covers a full OTP sign-in"
status: todo
milestone: M5
branch: task/T-0738-auth-switch-to-sql-adapter
model: auto
effort: low
depends_on: [T-0737]
estimate: 0.2 day
---

# T-0738: login on the effect/sql adapter (D2 switch)

## Spec (written by Claude, do not edit)

### Why
Julio wants effect/sql to replace drizzle everywhere, and login is the last module on drizzle. T-0690 built a better-auth adapter over effect/sql (`apps/server/src/auth/sql-adapter.ts`); T-0737 fixed its timestamps on real Postgres and proved them under two time zones. This task switches `auth.ts` to that adapter. **The lead holds the launch until Julio says yes**, because this is the login path.

### Verified facts (do not re-derive)
- **`apps/server/src/auth/auth.ts`:**
  - line 2 imports `drizzleAdapter` from `better-auth/adapters/drizzle`, and line 7 imports `* as schema` from `../db/schema`;
  - line 48 is `database: drizzleAdapter(db, { provider: 'pg', schema })`.
- **`effectSqlAdapter(db)`** is exported at `apps/server/src/auth/sql-adapter.ts:384`.
- **`clauseFragment`** (`sql-adapter.ts:93-129`) binds a where value as it is, so on real pg a `Date` binds as `timestamptz` (`@effect/sql-pg` `dist/PgTypes.js:23-27`). Writes already bind through `bindRow`, which calls `PgTypes.timestamp` (`sql-adapter.ts:209-219`).
- **The gated real-pg test** is `apps/server/src/auth/sql-adapter.pg.test.ts`, run with `ZILAR_PG_INTEGRATION=1`; it uses the local dev Postgres only.
- **Tests:** `apps/server/src/auth/auth.test.ts` (the OTP flows), plus every test that signs in through `createTestContext`, which calls `createAuth` (`test-support.ts`).

### What to build
1. **`sql-adapter.ts`:** in `clauseFragment`, on real pg only, bind a `Date` where-value with `PgTypes.timestamp(value)`, as `bindRow` does; that includes `Date` values inside `in` and `not_in` lists. PGlite stays unchanged.
2. **`auth.ts`:** use `database: effectSqlAdapter(db)`, and remove the `drizzleAdapter` and `schema` imports. Keep every other option.
3. **`sql-adapter.pg.test.ts`:** add one test that builds `betterAuth` with the same options as `createAuth`, on the real-pg db, and runs a full email-OTP sign-up and sign-in (take the mailer fake from `auth.test.ts`). It runs under `TZ=Europe/Madrid`, then checks that the session's `expiresAt` is about now plus the session lifetime, not shifted by hours. Delete only the rows it created.

### Read first
`AGENTS.md`, `apps/server/src/auth/auth.ts`, `apps/server/src/auth/sql-adapter.ts`, `apps/server/src/auth/sql-adapter.pg.test.ts`, `apps/server/src/auth/auth.test.ts` (setup and one OTP flow).

### Allowed files
`apps/server/src/auth/auth.ts`, `apps/server/src/auth/sql-adapter.ts`, `apps/server/src/auth/sql-adapter.pg.test.ts`, `work/T-0738-auth-switch-to-sql-adapter.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth
ZILAR_PG_INTEGRATION=1 TZ=Europe/Madrid pnpm --filter @zilar/server test --maxWorkers=1 --reporter=dot src/auth/sql-adapter.pg.test
pnpm gate
```

### Acceptance
- `auth.ts` imports nothing from drizzle or `../db/schema`.
- The whole server suite passes in the gate.
- The gated real-pg OTP test passes, with its output in the Report.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

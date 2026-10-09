---
id: T-0738
title: "D2 switch (NEEDS JULIO'S GO): auth.ts uses effectSqlAdapter(db) instead of drizzleAdapter; the adapter's where-clause Date values bind with PgTypes.timestamp on real pg; auth tests pass on PGlite and the gated real-pg test covers a full OTP sign-in"
status: merged
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

### What changed
- `apps/server/src/auth/auth.ts`: `database: effectSqlAdapter(db)` (line 47). The `drizzleAdapter` and `../db/schema` imports are gone (`grep drizzle|schema` on the file: no match). Every other option is unchanged.
- `apps/server/src/auth/sql-adapter.ts`: `whereFragment` and `clauseFragment` take `db`. A new `bindValue(db, value)` gives a `Date` to `PgTypes.timestamp` on real pg only (PGlite unchanged). Every where value goes through it, including the `in` and `not_in` lists. `bindRow` now uses the same helper, so written and compared values bind the same way.
- `apps/server/src/auth/sql-adapter.pg.test.ts`: one new gated test, "signs up and back in with an email OTP through createAuth...". It builds the auth with `createAuth` (same options by construction, so no copy of the options) and calls `auth.handler` directly. It sends the code with an invite, signs up, checks the session `expiresAt` is within 60 s of now plus 7 days, then checks a boundary window around that expiry (see the open question). Then it signs in again and expects 2 sessions. Cleanup in `finally` deletes only that test's rows: the OTP verification rows by its random email, the user by its random email (cascades sessions, accounts, XMPP account, user_invites), and the invite by its id. The mailer is `TestMailer` and the adminClient is `FakeAdminClient`, both from `test-support.ts`. The existing 3 tests are unchanged.
- `work/T-0738-auth-switch-to-sql-adapter.md`: status only.

### Commands and results
- `pnpm install`: done, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth`: Test Files 7 passed, 1 skipped (the gated pg file); Tests 82 passed, 4 skipped.
- Gated real pg, the Checks command with `ZILAR_PG_INTEGRATION=1 TZ=Europe/Madrid`, `--maxWorkers=1`, verbose reporter:
  ```
  ✓ round trips expiresAt through the adapter and stores the UTC wall clock 25ms
  ✓ reads a verification row written by drizzleAdapter at the same instant 18ms
  ✓ reads a verification row written by the adapter through drizzleAdapter at the same instant 5ms
  ✓ signs up and back in with an email OTP through createAuth, with the session expiry at now plus the lifetime 63ms
  Test Files 1 passed (1)   Tests 4 passed (4)
  ```
  Before running, I checked the dev `DATABASE_URL` from the galena `.env` with a `sed` that prints only the scheme and host: `scheme=postgres host=127.0.0.1`. Its password was never printed.
- After the run, a read-only count of `user` rows with `pg-otp-%` emails returned 0. The same query showed the dev DB session `TimeZone` is `Etc/UTC`.
- Mutation check: I set the where-value binding to the raw value, reran the gated file, and it still passed 4/4. So on this dev DB the where-clause change is not observable by the gated test. I restored the line and reran: 4/4 passed (the output above is from the restored code).
- `pnpm exec prettier --write` on the three files: done.
- `pnpm gate`: see the summary lines below.

Gate summary (from the worktree root):
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (15.3s)
PASS  lint  (1.1s)
PASS  typecheck  (4.1s)
PASS  tests @zilar/server  (10.4s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Open question (decision for the lead)
- The where-clause Date binding is correct code but is not proven by the gated test. Better-auth filters sessions by a Date `expiresAt` only in some paths (`dist/db/internal-adapter.mjs`), and the OTP sign-in does not take one of them. The dev DB's session is UTC, so a Date compares the same with or without the fix. To make the test discriminate, the test client would need a Madrid session. postgres.js passes an unknown URL query such as `?timezone=Europe/Madrid` as a startup parameter (`node_modules/postgres/src/index.js:484-488`). But that would also change the drizzle comparison test's write path (drizzle binds a `Date` as `timestamptz`), so it needs a second client just for the boundary check. I did not do this, since the spec asked for one test and no extra client. Tell me if you want it.

### Deviations and notes
- The new test uses `createAuth` and `auth.handler`, not a hand-copied `betterAuth` options object and not `createApp` (the spec said "same options as createAuth"; using the function guarantees it).
- I set `status: in-progress` and then `review` with `sed -i` on the single front-matter line, not the edit tool. Only that one line changed (verified by the diff stat: 2 lines in the task file).

### Unsure about
- Whether the gated test should prove the where-clause Date binding (see the open question above); as written it does not.

## Review (written by Claude)

**2026-10-09, lead:** approved. Julio OKed D2. Worker: Haiku 5.5, in one round (about 5.6 min). The lead reviewed the diff directly.
- **The switch:** `auth.ts` uses `effectSqlAdapter(db)`, with no drizzle or schema import.
- **Binding:** where values go through `bindValue`, so `Date` values bind with `PgTypes.timestamp` on pg, the same as writes; PGlite is unchanged.
- **Tests:** the gated real-pg suite passes 4/4 under `Europe/Madrid`, including a full OTP sign-up and sign-in. The gate passed.
- **Not proven:** the where-date path itself, because the dev Postgres session is UTC (as is production).
- **Before the next live deploy:** the T-0739 image fix comes first, and the lead runs a sign-in against the fixed image locally.

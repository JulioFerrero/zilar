---
id: T-0690
title: "D2 step 1: build a custom better-auth database adapter over effect/sql (auth/sql-adapter.ts, built with createAdapterFactory) and test it against the four auth tables on PGlite; production keeps drizzleAdapter for now"
status: merged
milestone: M5
branch: task/T-0690-better-auth-sql-adapter
model: auto
effort: low
depends_on: []
estimate: 0.4 day
---

# T-0690: a better-auth adapter over effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. better-auth is the last drizzle user that is not a module, through `drizzleAdapter` at `apps/server/src/auth/auth.ts:2,48`. The lead decided on 2026-10-07 (`work/NOW.md`, "Lead decisions tonight") that better-auth moves to a **custom adapter over effect/sql**, with no new dependency. That was option 1 in `docs/audit/effect-sql-migration.md` §c. This task builds and tests the adapter. **The production switch in `auth.ts` is a later task.**

### Verified facts (do not re-derive)
- **better-auth 1.7.6** (`apps/server/package.json:23`):
  - `better-auth/adapters` re-exports `@better-auth/core/db/adapter` (`createAdapterFactory`, `AdapterFactoryOptions`, `CustomAdapter`, …); see `node_modules/.pnpm/better-auth@1.7.6*/node_modules/better-auth/dist/adapters/index.d.mts`;
  - the shipped `@better-auth/memory-adapter@1.7.6` and `@better-auth/kysely-adapter@1.7.6` (both in `node_modules/.pnpm`) are worked examples of `createAdapterFactory({ config, adapter })`, implementing `create`, `findOne`, `findMany`, `update`, `updateMany`, `delete`, `deleteMany`, `count` and the where operators.
- **The auth tables** come from `apps/server/src/auth/auth-schema.ts` and are created by the SQL history:
  - `user`;
  - `session`;
  - `account`;
  - `verification`.

  Their columns are listed in `docs/audit/effect-sql-migration.md` §c. The DB uses snake_case; better-auth field names are camelCase.
- **Today:** `auth.ts:48` has `database: drizzleAdapter(db, { provider: 'pg', schema })`. The rest of the server reaches effect/sql through `sqlRuntimeFor(db)` (`apps/server/src/effect/sql.ts:98`), and `createTestContext` registers a runtime for the test db.
- **Tests:** `apps/server/src/auth/auth.test.ts` (the OTP sign-up and sign-in flows) and `createTestContext` in `apps/server/src/test-support.ts`.

### What to build
1. **Add `apps/server/src/auth/sql-adapter.ts`:**
   - export `effectSqlAdapter(db: ServerDatabase)`, built with `createAdapterFactory`;
   - every operation runs one or more statements through `sqlRuntimeFor(db).runPromise`;
   - map field and model names to the snake_case columns (use the factory's field-name mapping, or an explicit map for the four tables);
   - support the where operators better-auth sends (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `contains`, `starts_with`, `ends_with`, with AND/OR connectors), `sortBy`, `limit` and `offset`, as the memory adapter does;
   - set `supportsJSON`, `supportsDates` and `supportsBooleans` correctly for Postgres;
   - set `transaction: false` unless you implement it with `sql.withTransaction`.
2. **Add `apps/server/src/auth/sql-adapter.test.ts`:**
   - drive the adapter directly on the test context: create, find (by id, by unique email or token), update, the `count`/`deleteMany` operators, and `in`/`OR` filters, on the four tables;
   - then build a `betterAuth({ database: effectSqlAdapter(context.db), … })` with the same plugins as `auth.ts`, and run one full email-OTP sign-up and sign-in. Copy the steps from `auth.test.ts`; the mailer fakes are there.
3. **Do not change `auth.ts`** or any other production file.

### Read first
`AGENTS.md`, `apps/server/src/auth/auth.ts`, `apps/server/src/auth/auth-schema.ts`, `apps/server/src/auth/auth.test.ts` (setup and one sign-up flow), `docs/audit/effect-sql-migration.md` §c, and the memory and kysely adapter sources in `node_modules/.pnpm`.

### Allowed files
`apps/server/src/auth/sql-adapter.ts`, `apps/server/src/auth/sql-adapter.test.ts`, `work/T-0690-better-auth-sql-adapter.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test
pnpm gate
```

### Acceptance
- The adapter and its tests pass, including one full OTP sign-up and sign-in through better-auth.
- `auth.ts` is unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Built a better-auth custom database adapter over `effect/sql` and tested it on
PGlite, without touching `auth.ts`.

**`apps/server/src/auth/sql-adapter.ts`** — exports
`effectSqlAdapter(db: ServerDatabase)`, a `createAdapterFactory` factory that
implements `create`, `findOne`, `findMany`, `count`, `update`, `updateMany`,
`delete` and `deleteMany`, each running on `sqlRuntimeFor(db).runPromise`.

- Field/model mapping is an explicit map for the four tables (`user`, `session`,
  `account`, `verification`); unlisted fields keep their name. Results are read
  via `snakeToCamel` (already configured on the effect/sql client), so canonical
  camelCase rows come back.
- Where operators: `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `not_in`,
  `contains`, `starts_with`, `ends_with`, with `AND`/`OR` folding left to right
  like the memory adapter; `LIKE`/`ILIKE` per `mode`, wildcards escaped;
  `sortBy`, `limit`, `offset`.
- Config: `supportsJSON: true`, `supportsDates: true`, `supportsBooleans: true`,
  `transaction: false`.
- Two small behaviours needed to match what `drizzleAdapter` did for the schema:
  - `session.updated_at` and `account.updated_at` have no DB default (drizzle
    supplies them from `$onUpdate` on insert), so `create` fills `updated_at`
    when missing.
  - the auth tables use `timestamp` with no time zone; the PGlite driver writes
    a `Date` as UTC wall clock but parses it back as local time, so rows are
    normalized back to UTC on read (identity on a UTC host). Postgres-parsed
    auth rows and this round trip are equivalent to drizzle's `+0000` parse.

**`apps/server/src/auth/sql-adapter.test.ts`** — 8 tests:
- direct adapter on `createTestContext`: create/find by id, by unique email, by
  unique session token; update; `count`; `in` and `OR` filters; `deleteMany`;
  account and verification round-trips; a raw check that `email_verified` and
  `created_at` are the stored snake_case columns.
- one full email-OTP sign-up **and** sign-in through
  `betterAuth({ database: effectSqlAdapter(context.db), plugins: [emailOTP, bearer] })`
  using the `TestMailer` fake, asserting 200 + a session cookie and the stored
  user row.

`auth.ts` and every other production file are unchanged.

### Commands and results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/auth/sql-adapter.test`
  → **8 passed** (1 file). I ran no other test file.
- `pnpm gate` (from repo root) →

```
gate: 3 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (13.9s)
PASS  lint  (0.8s)
PASS  typecheck  (2.8s)
PASS  tests @zilar/server  (10.8s)
scope: every changed file is inside the Allowed files
GATE PASS
```

The 3 changed files are the two Allowed source files plus this task file.

### Problems / deviations from the spec

- Two runtime issues showed up only once the OTP flow exercised real rows, and
  are fixed as described above: the missing `updated_at` default and the
  PGlite `timestamp` timezone round trip (`OTP_EXPIRED` until reads were
  normalized).
- The date normalization is keyed off the factory schema's `type: 'date'`
  fields. It is correct for the four tables here (all `timestamp` without time
  zone). It should be re-checked when the production switch happens, since
  production goes through `@effect/sql-pg` rather than PGlite.

### Open questions

- For the later "switch `auth.ts`" task: confirm the production pg driver parses
  `timestamp` (without time zone) the same way as PGlite; if it parses as UTC
  already, the read normalization should be dropped/guarded.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 25923e4f) with 2 nits: an unreachable snake_case fallback in `create()`, and `LIKE`/`sortBy`/`offset` have no tests. The adapter passes a full email-OTP sign-up and sign-in through better-auth on PGlite, and `auth.ts` is unchanged.
- **Follow-up for the switch task:** check how production `@effect/sql-pg` parses `timestamp` without a time zone before relying on `utcTimestamp`, and add tests for the `LIKE`, `sortBy` and `offset` paths.

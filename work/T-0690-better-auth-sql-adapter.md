---
id: T-0690
title: "D2 step 1: build a custom better-auth database adapter over effect/sql (auth/sql-adapter.ts, built with createAdapterFactory) and test it against the four auth tables on PGlite; production keeps drizzleAdapter for now"
status: todo
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

## Review (written by Claude)

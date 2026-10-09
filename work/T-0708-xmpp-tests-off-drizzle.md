---
id: T-0708
title: "tests off drizzle (xmpp): replace every drizzle query in xmpp/provisioning.test.ts, xmpp/routes.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0708-xmpp-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0708: xmpp tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the xmpp folder.

### Verified facts (do not re-derive)
- `apps/server/src/xmpp/provisioning.test.ts` (167 lines): drizzle at lines 2, 8, 82, 96.
- `apps/server/src/xmpp/routes.test.ts` (247 lines): drizzle at lines 6.
- **`testSql(context)`** is in `apps/server/src/test-support.ts` (T-0695). Use it as `await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<Row>\`...\`; }))`, with the imports `import { Effect } from 'effect'; import { SqlClient } from 'effect/sql';`. The worked example is `apps/server/src/pins/pins.test.ts`.
- **Results come back camelCased** (`transformResultNames`, `apps/server/src/effect/sql.ts:56`), and the SQL must name the **snake_case** columns. Keys passed to `sql.insert(...)` must be snake_case too. `"user"` must be quoted. Use `count(*)::int` for counts, and `${JSON.stringify(value)}::jsonb` for jsonb.
- **Drizzle filled some columns in JavaScript** (`$defaultFn`, `$onUpdate` in `apps/server/src/db/schema.ts`). The database does not, so a raw insert must give those values itself: check each table's columns in `schema.ts`. Columns with a SQL default (`defaultNow()`, `default(...)`) can be left out.

### What to build
1. **In each file above,** replace every drizzle query (seed inserts, updates, deletes, reads used by assertions) with `testSql(context)(...)`. Keep the same rows, values, order and assertions. Select only the columns a test reads, and give them a small local row type.
2. **Remove** the `drizzle-orm` and `../db/schema` imports, including any dynamic `import('../db/schema')`.
3. **Leave alone** the lines that pass `context.db` to a module function (`db: context.db`, `claimHandle(context.db, …)`): they are not drizzle queries.
4. **Values whose JS type differs** from drizzle (timestamps, numerics, jsonb): adapt only the read, never the meaning of an assertion. If a test cannot pass without changing what it checks, stop and ask (status: blocked).

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` §2 (lines 249-390), `apps/server/src/pins/pins.test.ts` (the worked example), the files above, and the matching tables in `apps/server/src/db/schema.ts`.

### Allowed files
`apps/server/src/xmpp/provisioning.test.ts`, `apps/server/src/xmpp/routes.test.ts`, `work/T-0708-xmpp-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/xmpp/provisioning.test.ts src/xmpp/routes.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/xmpp/provisioning.test.ts apps/server/src/xmpp/routes.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What changed (2 files, +39 / -13):**
- `apps/server/src/xmpp/provisioning.test.ts`: the seed insert into `"user"` is now a raw `INSERT INTO "user" (id, name, email, email_verified) VALUES (...)` through `testSql(context)`. `user` has no JS-filled columns on insert (`created_at` and `updated_at` use the DB default), so nothing else is needed. The two `context.db.select().from(xmppAccounts)` length checks now go through a small helper `xmppAccountUserIds` (`SELECT user_id FROM xmpp_accounts`). The `drizzle`/`db/schema` import is gone.
- `apps/server/src/xmpp/routes.test.ts`: the two `failing.db.select().from(xmppAccounts)` reads now go through a helper `xmppAccountRows` (`SELECT provisioned FROM xmpp_accounts`, row type `{ provisioned: boolean }`). The `db/schema` import is gone.
- Left alone, as the spec says: `context.db` passed to `createInvite`, `createApp`, `ensureXmppAccount`, `findXmppAccount`.
- Assertions are unchanged: I kept `toHaveLength(1)` on the selected rows rather than switching to `count(*)::int`, so the meaning and the form of each check match the original.
- Deviation: the first gate run failed typecheck (TS4104, sql results are `readonly` arrays). I changed the two helper return types to `ReadonlyArray<...>`, reran prettier, and reran the gate.

**Test counts (single files, `--maxWorkers=2 --reporter=dot`):**
- Before: `src/xmpp/provisioning.test.ts src/xmpp/routes.test.ts`: 2 files passed, 21 tests passed.
- After: the same command: 2 files passed, 21 tests passed.

**Commands and results:**
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/xmpp/provisioning.test.ts apps/server/src/xmpp/routes.test.ts`: no output (exit 1).
- `pnpm install`: exit 0.
- `pnpm exec prettier --write` on both files: run twice, after the type fix.
- `pnpm gate` (first run): GATE FAIL at typecheck, the TS4104 errors above. Fixed.
- `pnpm gate` (second run, final), exit 0:
  - `PASS  install (frozen)`
  - `PASS  format`
  - `PASS  lint`
  - `PASS  typecheck`
  - `PASS  tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
- `git status --short` in the worktree shows only the two test files. No scratch files were left in the worktree; gate logs went to the session scratchpad.

**Open questions:** none.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 5.8 min). The lead reviewed the diff directly. The user seed and the `xmpp_accounts` reads are on `testSql`, and keeping `toHaveLength` over selected columns is fine. There are 21 tests before and after, no drizzle import is left, and the gate passed.

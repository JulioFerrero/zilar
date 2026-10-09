---
id: T-0707
title: "tests off drizzle (invite-links): replace every drizzle query in invite-links/invite-links.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0707-invite-links-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0707: invite-links tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the invite-links folder.

### Verified facts (do not re-derive)
- `apps/server/src/invite-links/invite-links.test.ts` (884 lines): drizzle at lines 3, 8, 9, 10, 11, 116, 121, 136, 189, 270, 279, 286, 315, 361, 425, 430, 457, 462, 474, 477, 487, 504, 510, 519, 802, 814.
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
`apps/server/src/invite-links/invite-links.test.ts`, `work/T-0707-invite-links-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/invite-links/invite-links.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Status:** done, all checks pass.

### What I did
Replaced every drizzle read/seed in `apps/server/src/invite-links/invite-links.test.ts` with `testSql(context)(Effect.gen(...))` raw SQL against `effect/sql`, keeping the same rows, values, order and assertions. Removed the `drizzle-orm` (`and`, `eq`) and `../db/schema` (`auditLog`, `groupInviteLinks`, `groupMembers`, `groups`) imports, and the now-unused `user` import from `../auth/auth-schema` (the only use was the `cap`-loop insert). Added `import { Effect } from 'effect'` and `import { SqlClient } from 'effect/sql'` and `testSql` to the `../test-support` import.

All 18 drizzle query sites (the spec's line list) are covered by 20 `testSql` calls:
- reads: `audit_log` action/detail; `group_invite_links` token_hash/token_hint/label; `group_members` role / user_id; `groups` room_localpart — each selects only the columns an assertion reads, with a small local row type.
- writes: `UPDATE group_members SET role`; `UPDATE group_invite_links SET expires_at` (binds a `Date`); the cap-loop `INSERT INTO "user"` and `INSERT INTO group_members`.
- The cap-loop `"user"` insert supplies `id, name, email` only: `email_verified` has a SQL default `false`, and `created_at`/`updated_at` have `defaultNow()` (so the JS-only `$onUpdate` never runs in raw SQL, but the DB default covers it).
- Left `db: context.db` in `serviceDeps` (line 425) untouched, as the spec requires; it is the only remaining `context.db` reference.

### Files changed
- `apps/server/src/invite-links/invite-links.test.ts` (only file with code changes)
- `work/T-0707-invite-links-tests-off-drizzle.md` (this task file)

### Commands and results
- `pnpm install` — Done, 0 errors (peer-dep warnings only).
- Before conversion: `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/invite-links/invite-links.test.ts` → **21 passed** (1 file).
- After conversion: same command → **21 passed** (1 file), 21.15s. Same count, no test changed.
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/invite-links/invite-links.test.ts` → no output (acceptance met).
- `pnpm gate` (first run) → `GATE FAIL`, only `FAIL format` (Prettier line-wrapping in my file). I ran `pnpm exec prettier --write` on the one allowed file and re-ran the gate.
- `pnpm gate` (final) summary:
  ```
  PASS  install (frozen)  (2.4s)
  PASS  format  (29.8s)
  PASS  lint  (1.4s)
  PASS  typecheck  (7.5s)
  PASS  tests @zilar/server  (23.4s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations from the spec
None. I also removed the `user` import from `../auth/auth-schema`; the spec only named `drizzle-orm` and `../db/schema`, but that import became unused after the insert was converted and lint would have failed otherwise. No dependency was added.

### Problems / notes
- The `expires_at` update binds a JS `Date` through the `effect/sql` PGlite param encoder; the expired-link test passes, so dates bind correctly.
- Timestamps/JSON read back camelCased (`expiresAt`, `tokenHash`, …) with jsonb keys preserved (`transformJson: false`); no assertion meaning changed.
- No blockers, no open questions.

### Security checklist
- No secrets, tokens or OTPs are logged or committed; the token is only hashed in assertions, and unchanged log-leak tests still pass.
- Updates/deletes remain scoped (the two `UPDATE`s name `group_members` by group+user and `group_invite_links` by id).
- Test-only change; no route, permission, rate-limit or audit behaviour touched.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 3efa12fb).
- **Follow-up:** the stale "drizzle service" comment at `invite-links/api.ts:4`. It goes into the comment sweep.

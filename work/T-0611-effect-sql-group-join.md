---
id: T-0611
title: "effect/sql: groups/join.ts (public group join) off drizzle; the transaction keeps the per-group advisory lock before the occupant count, the in-tx re-check, the room call with 503 rollback and the ON CONFLICT DO NOTHING insert; same 404/409/503 answers; tests unchanged"
status: merged
milestone: M5
branch: task/T-0611-effect-sql-group-join
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0611: joining a public group, on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example at `apps/server/src/pins/service.ts:179`. `apps/server/src/groups/join.ts` (157 lines) is self-contained: no caller passes a transaction into it, which the lead checked with grep.

### Verified facts (do not re-derive; read the whole file; the comment at 32-42 is the contract)
**`joinPublicGroup` (43-141). The fast path:**
- the group by id (49): unknown, or not `public`, gives **404 `not_found` "Group not found"**;
- the member check (55-58): already a member returns `alreadyMember: true`;
- the pre-check `countOccupants + 1 > maxMembers` gives **409 `group_full` "This group is full"**.

**The transaction (76-111), in this order:**
1. `pg_advisory_xact_lock(hashtext('group-join:' || groupId))`, taken **before** counting;
2. re-check the membership; if the user is already a member, return `false`;
3. `countOccupants` (inside the transaction, under the lock) gives the same 409;
4. `adminClient.setAffiliation`. An `HttpError` is rethrown; anything else becomes **503 `xmpp_unavailable`**;
5. insert into `group_members` with `ON CONFLICT (group_id, user_id) DO NOTHING RETURNING`, and return `inserted.length > 0`.

**Every throw inside the transaction must roll back, and the same `HttpError` must reach the caller.** Read how `apps/server/src/chat-folders/service.ts` (lines 150-280) surfaces errors from inside `sql.withTransaction`.

**After the commit** (unchanged): `syncPublicTopicsByLink`, the best-effort invitation (logged), and the audit record.

**`countOccupants` (147-157):** `count(*)` over `group_members` plus `group_ais`. Use `count(*)::int AS total`. It must run on the transaction connection inside the transaction and on the plain runtime outside it; an Effect that `yield*`s `SqlClient` does this naturally.

**The recipe:** `sql.withTransaction`; locks as raw SQL; a private `runSql(db, effect)`.

**Tests (all unchanged):**
- `apps/server/src/groups/*.test.ts`;
- `apps/server/src/invite-links/*.test.ts`;
- the authz sweep (`authz-sweep`).

### What to build
1. Convert `groups/join.ts` with the same order, lock, cap, conflict handling, errors and post-commit steps. It keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/chat-folders/service.ts` (lines 150-280) and `apps/server/src/groups/join.ts`.

### Allowed files
`apps/server/src/groups/join.ts`, `work/T-0611-effect-sql-group-join.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups invite-links authz-sweep
pnpm gate
```

### Acceptance
- Joining a public group runs on effect/sql with the same answers and the same cap guarantee.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Converted `apps/server/src/groups/join.ts` from drizzle to `effect/sql` (recipe
`docs/audit/effect-sql-migration.md` §(a), pins example). Same shape: the
exported `joinPublicGroup` stays `async`, a private `runSql(deps, effect)` runs
each effect through `sqlRuntimeFor(deps.db)`, and the module keeps no value
import from `drizzle-orm` or `db/schema` (only a type-only `groups` import for
the row type, matching `chat-folders/service.ts:10`).

Order, lock and answers are unchanged:

1. group lookup `SELECT * FROM groups WHERE id = ${groupId} LIMIT 1`; unknown or
   non-`public` → 404 `not_found` "Group not found";
2. membership pre-check → `alreadyMember: true`;
3. pre-check `countOccupants + 1 > maxMembers` → 409 `group_full`;
4. `sql.withTransaction`: `pg_advisory_xact_lock(hashtext('group-join:'||id))`
   **before** counting; in-tx membership re-check; in-tx `countOccupants`;
   `setAffiliation` via `Effect.tryPromise` (an `HttpError` is rethrown, anything
   else → 503 `xmpp_unavailable`); insert with `ON CONFLICT (group_id, user_id)
   DO NOTHING RETURNING group_id` and `inserted.length > 0`. Every failure inside
   the transaction is in the effect error channel, so it rolls back and the same
   `HttpError` reaches the caller;
5. after the commit: `syncPublicTopicsByLink`, best-effort invitation (logged),
   audit record — unchanged.

`countOccupants` is now an `Effect` that yields `SqlClient`, so it resolves to
the transaction connection inside the transaction and to the plain runtime
outside it. It uses `count(*)::int AS total` over `group_members` + `group_ais`.

### Files changed

- `apps/server/src/groups/join.ts` (only value file changed; formatted by
  prettier).
- `work/T-0611-effect-sql-group-join.md` (this Report + status).

### Commands run (real results)

- `pnpm install` — exit 0 (1173 packages, 3 deprecated subdeps warning; the
  `@types/react-dom` peer warning is pre-existing mobile noise).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups/visibility.test.ts`
  — 1 file, **24 passed** (the join-cap tests included).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot groups invite-links authz-sweep`
  — 4 files, **106 passed**, 0 failed.
- `pnpm gate` — **GATE PASS**:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.4s)
  PASS  format  (24.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.0s)
  PASS  tests @zilar/server  (548.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Notes / deviations

- No test file was edited; every listed test is unchanged and green.
- The insert returns `group_id`, not `id`: `group_members` has the composite
  primary key `(group_id, user_id)` and no `id` column (`db/schema.ts:339-352`).
  The check is still `inserted.length > 0`.
- No drizzle value import remains in `join.ts`.
- Environment note: earlier `pnpm gate` attempts were killed by the harness /
  timed out only in unrelated files (`push/service.effect.test.ts`,
  `search/search.test.ts`, `push/component.test.ts`) while load average was ~40
  from parallel workers. Those files are unrelated to this change and the final
  foreground gate above passed all of `@zilar/server`.
- Security checklist: cap enforced atomically (advisory lock in the transaction,
  state re-read inside it); unknown/private both 404; audit detail carries ids
  only; no new route. Nothing changed there.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (18:32) is newer than HEAD 789b576f.
- **No test file changed.**
- **Lead check:**
  - only a type import from the schema is left;
  - the `group-join:` lock is taken inside `withTransaction` before the occupant count;
  - the insert is `ON CONFLICT (group_id, user_id) DO NOTHING`;
  - the gate passes.

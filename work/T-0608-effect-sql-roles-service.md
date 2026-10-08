---
id: T-0608
title: "effect/sql: roles/service.ts fully off drizzle (create-role under the per-group advisory lock + cap, the replace-the-set member transaction with ON CONFLICT DO NOTHING, rename/delete, the topic role lookups) via sql.withTransaction per the pins recipe; same caps, locks, diffs and audit; tests unchanged"
status: merged
milestone: M5
branch: task/T-0608-effect-sql-roles-service
model: auto
effort: low
depends_on: [T-0596]
estimate: 1 day
---

# T-0608: the roles service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example at `apps/server/src/pins/service.ts:179`. **No caller passes a transaction into this module**, which the lead checked with grep. `dropMemberRoles` is called from `groups/service.ts:668` with the top-level `db`, after that function's own transaction has ended.

### Verified facts (do not re-derive; read the whole file, 623 lines, with 42 query sites)
- **`createRole`** (comment at 287, transaction at 295): `pg_advisory_xact_lock(hashtext(groupId))`, then `count(*)` against the per-group role cap, then the insert. **The count and the insert stay in one transaction under the lock.**
- **`setRoleMembers`** (comment at 431, transaction at 439): the same group lock, then compute the diff and replace the set. The insert at 453 is `onConflictDoNothing()`, so write `ON CONFLICT DO NOTHING` in SQL. **The returned diff (added and removed) must be identical**, because callers audit it.
- **The other exports** — `listRoles`, `roleHoldersByGroup`, `renameRole`, `deleteRole`, `dropMemberRoles` (494), `topicRoleHolderIds`, `holdsTopicRole`, `rolesOfTopic` — are plain statements. The last three are called by `topics/access.ts` (the module T-0605 moves). Keep every signature.
- **Statements on lists** (`IN (...)` or `ANY`) keep the existing empty-list guards.
- **The recipe:** `sql.withTransaction`; locks as raw SQL; counts as `count(*)::int AS total`; a private `runSql(db, effect)`; `SqlError` maps to the module's existing errors (check what it throws today, for example the 409 on a duplicate name, and keep each answer byte-identical).
- **Rows:** `snakeToCamel` gives camelCase, typed with the drizzle inferred types (type-only imports).
- **Tests (all unchanged):**
  - `apps/server/src/roles/*.test.ts`;
  - `apps/server/src/topics/*.test.ts`;
  - `apps/server/src/groups/*.test.ts`;
  - `apps/server/src/approvals/*.test.ts`;
  - the authz sweep (`authz-sweep`).

### What to build
1. Convert the whole file, with the same caps, locks, conflict behaviour, diffs and errors. It keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230) and `apps/server/src/roles/service.ts`.

### Allowed files
`apps/server/src/roles/service.ts`, `work/T-0608-effect-sql-roles-service.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot roles topics groups approvals authz-sweep
pnpm gate
```

### Acceptance
- The roles service runs on effect/sql, transactions included, with the same behaviour.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Resumed on top of the committed conversion (`59673bf0`, rebased onto `main`)
and the `resume` commit (`4eaa3243`). No source change was needed: I ran the
four suites the lead named, plus the `authz-sweep` the task's Checks list, one
at a time in the foreground with the verbose reporter so I could see progress.

### Runs (all one at a time, foreground, `--maxWorkers=2`)

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=verbose src/roles`
  → 1 file, **22 passed**, 7.62s. Every test printed as it completed; the last
  one was "clears attached roles and the approver role when a private topic goes
  public (round 3)". No stall.
- `… src/topics` → 2 files, **33 passed**, 8.49s. No stall.
- `… src/groups` → 2 files, **80 passed**, 14.48s. No stall.
- `… src/approvals` → 7 files, **127 passed**, 20.23s. No stall.
- `… authz-sweep` → 1 file, **5 passed**, 3.00s (the task's Checks name it;
  the lead's step list did not, so I ran it too).

No run came near the 3-minute no-progress mark; each finished in seconds, and
nothing pinned a CPU.

### Cause of the hang

**Not reproduced.** With clean foreground runs the whole `roles` surface (and
the three dependent suites) completes in under 21 seconds total. I found no
loop in the change, so there is no fix commit. I could not confirm the earlier
cause: the lead's context says the earlier `launchd` jobs had overheated the
machine, and a stale detached run saturating a core is consistent with "one
test fork at 100% CPU", but I have no evidence that pins it. I did not find any
unbounded loop in the conversion: every `IN (…)` / `ANY` list keeps its
empty-list guard (`roleHoldersByGroup`, `holderUserIds`, `syncTopicsWithRoles`,
`dropMemberRoles`, `rolesOfTopic`, and the guarded `nextRemoved` insert/delete
in `setRoleMembers`), and the two advisory-lock transactions are bounded.

### `pnpm gate` summary

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.0s)
PASS  format  (12.6s)
PASS  lint  (0.7s)
PASS  typecheck  (7.1s)
SKIP tests @zilar/server (no nearby test files)
scope: every changed file is inside the Allowed files
GATE PASS
```

Note for the lead: the gate's nearest-test selector finds no sibling
`service.test.ts` next to `apps/server/src/roles/service.ts`, so it **skips the
server tests** for this branch. The roles coverage lives in `roles.test.ts`,
which the selector does not pick. I therefore ran the listed tests manually
(above) so the "tests unchanged and green" acceptance is verified. This is a
gap in the near-test selection, not in the conversion.

### Files changed

- `work/T-0608-effect-sql-roles-service.md` (report + status) only. No source
  file changed in this round; the conversion is unchanged from `59673bf0`.

### Security checklist

No new routes, queries or audit writes in this round. The conversion keeps every
`where` scoped by group/role id, the per-group advisory-lock transactions, the
`ON CONFLICT DO NOTHING` insert and the ids-only audit detail. Nothing to
re-check beyond the prior round.

### Open questions

- None blocking. Only the gate's nearest-test skip noted above.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no nits, 1 follow-up. The packet head is 7c42da4e, the current HEAD.
- **Lead check:**
  - only `roles/service.ts` and this file changed;
  - both advisory-lock transactions are kept;
  - `ON CONFLICT DO NOTHING` is kept, and every empty-list guard is in place;
  - the error strings are identical;
  - roles 22, topics 33, groups 80, approvals 127 and authz-sweep 5 tests are green, each in seconds;
  - the earlier 50-minute hang did not reproduce (it was likely the launchd jobs).
- **Follow-up:** the gate's nearest-test selector skips `roles.test.ts` for `roles/service.ts`. It should also map `<dir>/service.ts` to the `<dir>/*.test.ts` files.

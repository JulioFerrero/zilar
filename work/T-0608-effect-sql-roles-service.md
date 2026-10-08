---
id: T-0608
title: "effect/sql: roles/service.ts fully off drizzle (create-role under the per-group advisory lock + cap, the replace-the-set member transaction with ON CONFLICT DO NOTHING, rename/delete, the topic role lookups) via sql.withTransaction per the pins recipe; same caps, locks, diffs and audit; tests unchanged"
status: todo
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

## Review (written by Claude)

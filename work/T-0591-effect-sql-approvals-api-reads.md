---
id: T-0591
title: "effect/sql: the inline drizzle reads in approvals/api.ts (AI owner, topic rows for canSeeTopic, group topics, rule by id, managed groups) move to effect/sql; rows keep their drizzle shapes; same 404s and visibility; tests unchanged"
status: merged
milestone: M5
branch: task/T-0591-effect-sql-approvals-api-reads
model: auto
effort: low
depends_on: [T-0584]
estimate: 0.5 day
---

# T-0591: the approvals API reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. `apps/server/src/approvals/api.ts` already serves on Effect HTTP but still runs 9 inline drizzle selects, all on `deps.db` with no transaction. `approvals/service.ts` is out of scope.

### Verified facts (do not re-derive)
- **Imports:** `and`, `eq`, `inArray` (line 17); `ais`, `approvalRules`, `groupMembers`, `topics` (22).
- **The reads:**
  - (420-426) `SELECT id, owner FROM ais WHERE id LIMIT 1`;
  - (441-447) `SELECT * FROM topics WHERE id LIMIT 1`, passed to **`canSeeTopic(db, topic: TopicRow, userId)`** (`topics/access.ts:116`), which takes the **full** topic row;
  - (469) `SELECT * FROM topics WHERE group_id = $1`, giving full rows (each again goes to `canSeeTopic`);
  - (501) `SELECT * FROM approval_rules WHERE id LIMIT 1`, passed to `canManageRuleFor(db, rule: typeof approvalRules.$inferSelect, ...)` (569);
  - (575) a topic by id inside `canManageRuleFor`, then (580-584) the AI owner;
  - (621) the topic by id in a loop inside `visibleTopicNames`;
  - (649-652) `SELECT group_id FROM group_members WHERE user_id = $1 AND role IN ('owner','admin')`.
- **Row shapes.** Effect/sql already maps snake_case to camelCase: `transformResultNames: snakeToCamel` in `apps/server/src/effect/sql.ts`, so `SELECT *` gives camelCase keys (`apps/server/src/audit/service.ts` relies on it).
  - The `topics` and `approval_rules` timestamps are timestamptz (`Date`), with no bigint or jsonb (`db/schema.ts:400-425, 1205-1230`; check).
  - Type each result as `TopicRow` and `typeof approvalRules.$inferSelect` (type-only imports), so `canSeeTopic` and `canManageRuleFor` stay unchanged.
- **The sql runtime:** a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`. Inside the handlers you may keep `Effect.promise(() => runSql(...))` for the smallest change.
- **When done:** `approvals/api.ts` has no value import from `drizzle-orm` or `db/schema`.
- **Tests (all unchanged):**
  - `apps/server/src/approvals/*.test.ts` (including `rules.routes.test.ts` and `routes.test.ts`);
  - the authz sweep (`authz-sweep`).

### What to build
1. Move the 9 reads to effect/sql, with the same rows, the same 404 shapes and the same visibility filtering.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/approvals/api.ts` (lines 400-654), `apps/server/src/agents/gateway/db.ts`, `apps/server/src/effect/sql.ts` and `apps/server/src/topics/access.ts` (lines 110-140).

### Allowed files
`apps/server/src/approvals/api.ts`, `work/T-0591-effect-sql-approvals-api-reads.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot approvals authz-sweep
pnpm gate
```

### Acceptance
- `approvals/api.ts` reads through effect/sql with the same answers.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Set `status: review`.

### What I did
Moved every inline drizzle read in `apps/server/src/approvals/api.ts` to `effect/sql`.
The file no longer imports any **value** from `drizzle-orm` or `db/schema`:
`approvalRules` is a type-only import used for `typeof approvalRules.$inferSelect`, and
`TopicRow` is a type-only import from `topics/access`. Rows keep their drizzle shapes, so
`canSeeTopic` and `canManageRuleFor` keep their signatures.

- Added the module-local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)` helper
  (same shape as `agents/gateway/db.ts` and `audit/service.ts`).
- Added effect/sql loaders: `loadTopicRow` (`SELECT * FROM topics WHERE id LIMIT 1`, typed
  `TopicRow`), `loadTopicsForGroup` (`SELECT * FROM topics WHERE group_id`), `loadAiOwnerRow`
  (`SELECT id, owner FROM ais WHERE id`), `loadApprovalRule` (`SELECT * FROM approval_rules
  WHERE id`, typed `typeof approvalRules.$inferSelect`).
- Converted the reads in `aiRules` (AI owner, then the per-rule topic), `groupRules`
  (group topics), `revokeRule` (rule by id), `canManageRuleFor` (topic + AI owner),
  `visibleTopicNames` (topic by id) and `managedGroupIdsForUser`
  (`group_id` with `role IN ('owner','admin')`).
- Same 404 shapes (`aiRow === null`, `existing === null`) and the same visibility
  filtering. No transaction was added; there was none before.

### Files changed
- `apps/server/src/approvals/api.ts` (Allowed).
- `work/T-0591-effect-sql-approvals-api-reads.md` (Allowed: status + this Report).

### Commands and results
- `pnpm install`: code 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot approvals`:
  7 files passed, **127 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot authz-sweep`:
  1 file passed, **5 tests passed**; the sweep printed 158 `/api` routes and all four
  approvals routes (`GET/POST/DELETE` under `/api/approvals*`, `/api/ais/:id/approval-rules`,
  `/api/groups/:id/approval-rules`, `/api/approval-rules/:id`) answered 401.
- `pnpm exec prettier --write apps/server/src/approvals/api.ts`: applied. The first `pnpm gate`
  run failed only on `format` for this file; prettier then reported "All matched files use
  Prettier code style!".
- `pnpm gate` (from the repo root), real summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (13.0s)
  PASS  format  (128.2s)
  PASS  lint  (1.2s)
  PASS  typecheck  (1.3s)
  PASS  tests @zilar/server  (1918.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The one file gate lists is `apps/server/src/approvals/api.ts`; the second changed
  file is this task file. No file outside the Allowed files.

### Problems / deviations
None. `approvals/service.ts` was left alone (out of scope); the file header comment still
describes the service as drizzle-backed, which is still true.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (13:36) is newer than HEAD 92646c80.
- **No test file changed.**
- **Lead check:** `approvals/api.ts` has only a type import of `db/schema`; the reads go through 5 effect/sql helpers, and the topic-by-id helper is reused.

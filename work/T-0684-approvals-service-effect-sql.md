---
id: T-0684
title: "effect/sql: move the rest of approvals/service.ts (createApproval, decideApproval's reads, verifyApproval, approverNamesForTopics, listDecidableApprovals, getDecidableApproval, expireStale, canDecide and the two decidable* helpers) onto effect/sql; the file drops drizzle"
status: todo
milestone: M5
branch: task/T-0684-approvals-service-effect-sql
model: auto
effort: low
depends_on: [T-0672]
estimate: 0.3 day
---

# T-0684: approvals service on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. T-0672 moved the `decideApproval` transaction. Every other statement in `approvals/service.ts` is still drizzle.

### Verified facts (do not re-derive)
- **`apps/server/src/approvals/service.ts`** has:
  - `runSql` (line 24);
  - `type ApprovalRow = typeof approvals.$inferSelect`;
  - `toApprovalRow(raw)` (line 201), which turns the raw effect/sql `approvals` row (`ApprovalSqlRow`, timestamps as `Date | string`) into `ApprovalRow`. **Every full `approvals` row read on effect/sql must go through `toApprovalRow`.**
- **The drizzle statements to move:**
  - `createApproval` (line 214):
    - `SELECT id FROM ais WHERE id LIMIT 1`;
    - with a group, the `group_ais` link (`ai_id` where `group_id`, `ai_id`, `LIMIT 1`) and the topic (`id, group_id` where `id`, `LIMIT 1`);
    - the pending count, `count(*)` where `ai_id` and `status = 'pending'` (use `count(*)::int`);
    - `INSERT INTO approvals (…) RETURNING *` with the `row` fields (`worst_case_amount` is a string or null);
    - it returns `ApprovalRow` and keeps the `Error('Failed to create approval')`;
  - `decideApproval` (line 306): the first read `SELECT * FROM approvals WHERE id LIMIT 1` (line 322), and the re-read after a lost race (line 419);
  - `verifyApproval` (line 442): the read (`SELECT *` by id) and `UPDATE approvals SET status = 'consumed' WHERE id AND status = row.status RETURNING id`; only the row's presence is used;
  - `approverNamesForTopics` (line 486):
    - `SELECT * FROM topics WHERE id IN unique` (guarded by the existing empty check);
    - the holder join: `group_member_roles` inner join `"user"` on `user_id`, inner join `group_roles` on `role_id`, inner join `group_members` on (`group_id = group_roles.group_id` AND `user_id = group_member_roles.user_id`); selecting `role_id`, `"user".name` and `"user".id AS user_id`; where `group_member_roles.role_id IN keys`;
  - `listDecidableApprovals` (line 543): `SELECT * FROM approvals WHERE (… OR …) ORDER BY created_at DESC LIMIT 100`. Each branch is `status = 'pending' AND expires_at > now AND ai_id IN …`, or the same with `group_id IN …`, and a branch is included only when its list is non-empty (the existing logic). Build it with `sql.or`/`sql.and` or fragments, as `agents/memory/store.ts:293-300` does;
  - `getDecidableApproval` (line 602): `SELECT * FROM approvals WHERE id LIMIT 1`;
  - `expireStale` (line 624): `UPDATE approvals SET status = 'denied', decided_at = now, note = 'expired' WHERE status = 'pending' AND expires_at < now RETURNING id, ai_id, group_id`;
  - `canDecide` (line 642):
    - `SELECT owner FROM ais WHERE id LIMIT 1`;
    - `SELECT * FROM topics WHERE id LIMIT 1` (or `getTopic` from `../topics/access`);
    - the approver-role check: `group_member_roles` join `group_roles` where `role_id`, `user_id`, `group_roles.group_id`, `LIMIT 1`;
    - the membership role (`role` from `group_members` where `group_id`, `user_id`, `LIMIT 1`);
  - `decidableAiIdsForUser` (line 696): `SELECT id FROM ais WHERE owner`;
  - `decidableGroupIdsForUser` (line 704): `SELECT group_id FROM group_members WHERE user_id AND role IN ('owner','admin')`.
- **The recipe:** camelCased result names; `"user"` quoted; `sql.in(list)`; timestamps passed as `Date`.
- **Tests:** `apps/server/src/approvals/*.test.ts` and `apps/server/src/actions/gateway.test.ts`.

### What to build
1. **Rewrite every listed statement** with `runSql`, with the same SQL meaning, order, limits, errors and texts, using `toApprovalRow` for full approval rows.
2. **Remove** the drizzle and unused `../db/schema` imports (`approvals` may still be needed for the `ApprovalRow` type).
3. **Change no exported signature.**

### Read first
`AGENTS.md`, `apps/server/src/approvals/service.ts`, `apps/server/src/agents/memory/store.ts` (lines 280-310).

### Allowed files
`apps/server/src/approvals/service.ts`, `work/T-0684-approvals-service-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals src/actions/gateway.test
pnpm gate
```

### Acceptance
- `approvals/service.ts` has no drizzle import.
- The approvals and gateway tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

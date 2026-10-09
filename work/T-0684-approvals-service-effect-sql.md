---
id: T-0684
title: "effect/sql: move the rest of approvals/service.ts (createApproval, decideApproval's reads, verifyApproval, approverNamesForTopics, listDecidableApprovals, getDecidableApproval, expireStale, canDecide and the two decidable* helpers) onto effect/sql; the file drops drizzle"
status: merged
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
`apps/server/src/approvals/service.ts`, `apps/server/src/actions/gateway.ts` (lead, round 2: only the approval + `pending_actions` transaction at about lines 496-530), `work/T-0684-approvals-service-effect-sql.md`.

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

Status: **review** — round 1 blocked on the gateway's drizzle transaction; the lead extended the
Allowed files (round 2) and the fix is in. See "Round 2" below.

### What I did (in `apps/server/src/approvals/service.ts`)
Rewrote every drizzle statement named in the spec with `runSql`, same SQL meaning/order/limits/errors:

- dropped `drizzle-orm` and the now-unused `../db/schema` imports; only `type { approvals }`
  remains, for `ApprovalRow`;
- `createApproval`: AI existence, `group_ais` link, topic `(id, group_id)` read, pending
  `count(*)::int`, and `INSERT INTO approvals (…) RETURNING *`; maps the insert row through
  `toApprovalRow`;
- `decideApproval`: the first `SELECT *` and the lost-race re-read (both through `toApprovalRow`);
- `verifyApproval`: the `SELECT *` and the `UPDATE … SET status = 'consumed' … RETURNING id`;
- `approverNamesForTopics`: the `topics` read and the `group_member_roles ⨝ "user" ⨝ group_roles
  ⨝ group_members` holder join;
- `listDecidableApprovals`: built with `sql.and`/`sql.or`/`sql.in` fragments inside the `Effect`,
  `ORDER BY created_at DESC LIMIT 100`, then `toApprovalRow` on every row;
- `getDecidableApproval`, `expireStale`, `canDecide` (owner read, topic via `getTopic`, approver
  role join, membership role), `decidableAiIdsForUser`, `decidableGroupIdsForUser`.

No exported signature changed.

### Evidence
- Baseline (my change stashed): `git stash push apps/server/src/approvals/service.ts` then
  `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/gateway.test`
  → `Test Files 1 passed (1)`, `Tests 46 passed (46)`. Stash popped.
- With the change:
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals`
    → `Test Files 1 failed | 6 passed (7)`, `Tests 3 failed | 124 passed (127)`. The 3 failures are
    all `approvals/rules.test.ts` end-to-end cases that go through the action gateway
    (`expected 'denied' to be 'pending_approval'`).
  - `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/gateway.test`
    → `Test Files 1 failed (1)`, `Tests 23 failed | 23 passed (46)`; failures read
    `expected { status: 'denied', reason: 'ai_not_active' } to deeply equal { status: 'pending_approval' }`.
- I temporarily added a `console.error` in `runSql` to read the swallowed error; the gateway catch
  hides it, and it is:
  `Error: No effect/sql runtime registered for this database`. Diagnostic reverted.

### Root cause
`apps/server/src/actions/gateway.ts:496-530` creates the approval inside a **drizzle**
transaction and then inserts the `pending_actions` row in the same transaction, so the two stay
atomic:

```
approvalId = await deps.db.transaction(async (tx) => {
  const approval = await createApproval(tx as unknown as ServerDatabase, { … });
  await tx.insert(pendingActions).values({ …, approvalId: approval.id, … });
  return approval.id;
});
```

The effect/sql runtime is registered per root `ServerDatabase` in a `WeakMap`
(`apps/server/src/effect/sql.ts:86-104`): `registerSqlRuntime(db, …)` in `createApp` /
`createTestContext`. A drizzle transaction object is a different object, so `sqlRuntimeFor(tx)`
throws. The gateway catches every error from that block and answers
`{ status: 'denied', reason: 'ai_not_active' }` (`gateway.ts:531-543`), which is what all the
failures show. The conversion itself is correct for direct calls: `approvals/service.test.ts`
and the rest of the approvals suite pass.

### Why it is not fixable inside the Allowed files
- `apps/server/src/actions/gateway.ts` is not in Allowed files.
- `apps/server/src/effect/sql.ts` (also not allowed) has no transaction support, and the Effect
  guide says a domain module must never create a runtime of its own
  (`docs/EFFECT_GUIDE.md:224`).
- The established pattern for exactly this situation is T-0670 (`removeGroupAi`): move the
  caller's `db.transaction` onto `runSql(db, Effect.gen(… sql.withTransaction(…)))` with the
  statements as Effects, then pass the root `db`. Doing that here means exporting a
  `createApprovalEffect` from `service.ts` and converting the gateway's approval + `pending_actions`
  pair in the same transaction.

### Question for the lead (resolved in round 2)
How should I proceed?
- **(Recommended)** extend Allowed files with `apps/server/src/actions/gateway.ts`, keep the
  service conversion, add `createApprovalEffect` and move the gateway's
  approval + `pending_actions` pair onto `runSql(deps.db, … sql.withTransaction(…))`; or
- leave `createApproval` on drizzle for now (e.g. split it into its own follow-up task) and drop
  the "no drizzle import" acceptance for this task; or
- give `sqlRuntimeFor` transaction support in `apps/server/src/effect/sql.ts` (also needs that
  file in Allowed files).

### Files changed
- `apps/server/src/approvals/service.ts` (the conversion)
- `work/T-0684-approvals-service-effect-sql.md` (status + this report)

### Round 2 (after the lead's decision)
The lead added `apps/server/src/actions/gateway.ts` (only the approval + `pending_actions`
transaction at about lines 496-530) to the Allowed files.

- `approvals/service.ts`: added `createApprovalEffect(input, now)` returning
  `Effect<ApprovalRow, SqlError | ApprovalServiceError | Error, SqlClient>`. Every validation
  check is a typed `Effect.fail(new ApprovalServiceError(...))` (and a plain
  `Effect.fail(new Error('Failed to create approval'))` when `RETURNING *` is empty), so the
  gateway's `catch` still sees an `ApprovalServiceError` instance. `createApproval(db, input, now)`
  is now the thin `runSql(db, createApprovalEffect(input, now))` wrapper; no exported signature
  changed.
- `actions/gateway.ts`: replaced `deps.db.transaction(async (tx) => …)` with
  `sqlRuntimeFor(deps.db).runPromise(Effect.gen(… sql.withTransaction(…)))`. The file's `runSql`
  (line 126) is typed to `SqlError.SqlError` only, so — as the lead allowed — the direct
  `sqlRuntimeFor(deps.db).runPromise` is used. Inside, `createApprovalEffect` runs first, then one
  `INSERT INTO pending_actions (id, approval_id, ai_id, group_id, topic_id, action, args,
  args_hash, requested_by, status)` with `${JSON.stringify(parsedArgs)}::jsonb` (so jsonb keys stay
  exactly as written), and returns `approval.id`. The surrounding `try { … } catch { … }` mapping
  is unchanged. `pendingActions` is still used by the `PendingActionRow` type and `ServerDatabase`
  by the helper signatures, so neither import was removed.

### Commands and real results (round 2)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals src/actions`
  → `Test Files 16 passed (16)`, `Tests 257 passed (257)`.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (2.2s)
  PASS  format  (31.2s)
  PASS  lint  (1.1s)
  PASS  typecheck  (4.5s)
  PASS  tests @zilar/server  (27.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Files changed (round 2)
- `apps/server/src/approvals/service.ts`
- `apps/server/src/actions/gateway.ts`
- `work/T-0684-approvals-service-effect-sql.md`

## Review (written by Claude)

**2026-10-09, lead:** approved after one lead decision round.
- **Pre-review:** clean, with no nits; the packet head is ef7dbeac.
- **Round 1:** it stopped correctly. The gateway created the approval inside a drizzle transaction that had no effect/sql runtime (seen as 23 gateway failures).
- **Round 2:** `createApprovalEffect` plus the `pending_actions` insert (args as `::jsonb`) now run in one `sql.withTransaction` in `actions/gateway.ts`. The catch is unchanged, and it maps every failure to `ai_not_active` as before. **`approvals/service.ts` now has no drizzle import.**

---
id: T-0672
title: "effect/sql (C1): move the decideApproval transaction (approvals/service.ts) onto sql.withTransaction, with createRule and findActiveRuleForUpdate (approvals/rules.ts) as Effects; createRule keeps an async wrapper for the tests"
status: todo
milestone: M5
branch: task/T-0672-approvals-decision-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.3 day
---

# T-0672: the approval decision on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `approvals/rules.ts` keeps `findActiveRuleForUpdate` and `createRule` on drizzle only because `decideApproval` passes them its drizzle `tx` (the comment at `rules.ts:77-80`).

### Verified facts (do not re-derive)
- **`apps/server/src/approvals/rules.ts`:**
  - `findActiveRuleForUpdate(tx, { aiId, groupId, topicId, action })` (line 81) selects the active rule: `ai_id`, then `topic_id IS NULL` or `= topicId`, `action`, and `revoked_at IS NULL`, `LIMIT 1`;
  - `createRule(tx, input, now)` (line 108) returns `{ rule: toPublicRule(existing), created: false }` if such a rule exists. Otherwise it inserts `(id = randomUUID(), ai_id, group_id, topic_id, action, created_by, created_at = now)` with `ON CONFLICT DO NOTHING RETURNING *` and returns `created: true`; if the insert returned nothing, it re-reads the winner, returning `created: false` or throwing `new Error('Failed to create approval rule')` (lines 108-152);
  - `findActiveRule(db, …)` (line 157) is the same read already on effect/sql: the model to copy, with its two `SELECT * FROM approval_rules …` branches and the `runSql` at line 45.
- **`apps/server/src/approvals/service.ts` `decideApproval`** (line 271, all drizzle; `createRule` imported at line 17). Its transaction (about lines 331-378):
  1. `UPDATE approvals SET status = decisionToStatus(decision), decided_by = userId, decided_at = now, note = note ?? null WHERE id = row.id AND status = 'pending' AND expires_at > now RETURNING *`;
  2. with no row, it returns `undefined`;
  3. on `approve_always`, `createRule(tx, { aiId, groupId, topicId, action, createdBy: userId }, now)` sets `createdRule`;
  4. it returns the decision row.

  After the commit (lines 380-390), with no row it re-reads and throws `expired` or `not_pending`. The returned row type is `ApprovalRow = typeof approvals.$inferSelect` (line 173), so timestamps are `Date`s. `worst_case_amount` is `numeric`, a string in both drizzle and effect/sql.
- **Other callers of `createRule(context.db, …)`:** many tests (`approvals/rules.test.ts`, `approvals/rules.routes.test.ts`, `actions/gateway.test.ts`). `findActiveRuleForUpdate` has no caller outside `rules.ts`.
- **Tests:** `apps/server/src/approvals/service.test.ts` (`decideApproval`, about line 315 on), `approvals/rules.test.ts`, and `approvals/routes.test.ts`.

### What to build
1. **`rules.ts`:**
   - replace `findActiveRuleForUpdate` with a private `findActiveRuleEffect(input)` (`Effect<ApprovalRuleRow | null, SqlError, SqlClient>`, the same SQL as `findActiveRule`), and make `findActiveRule` use it;
   - add `export function createRuleEffect(input, now)`, with the same steps and the same `Error` (through `Effect.fail(new Error('Failed to create approval rule'))`);
   - keep `export async function createRule(db, input, now)` as `runSql(db, createRuleEffect(input, now))` so the tests stay unchanged;
   - update the comment at lines 77-80.
2. **`service.ts` `decideApproval`:** add a private `runSql` (like `rules.ts:45`). Replace the `db.transaction` with `runSql(db, Effect.gen(… sql.withTransaction(…)))`, with step 1 as one `UPDATE … RETURNING *` statement and step 3 as `yield* createRuleEffect(...)`. Return the row with the same shape: map timestamp columns to `Date` if the client returns strings, and check `decided_at`, `expires_at` and `created_at`. Keep everything before and after the transaction as it is.
3. **Change no other function in `service.ts`.**

### Read first
`AGENTS.md`, `apps/server/src/approvals/rules.ts` (lines 1-200), `apps/server/src/approvals/service.ts` (lines 1-30, 165-400).

### Allowed files
`apps/server/src/approvals/rules.ts`, `apps/server/src/approvals/service.ts`, `work/T-0672-approvals-decision-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals
pnpm gate
```

### Acceptance
- `decideApproval` has no `db.transaction`.
- `rules.ts` has no drizzle in `createRule` or the read.
- The approvals tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

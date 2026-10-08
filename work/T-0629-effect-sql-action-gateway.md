---
id: T-0629
title: "effect/sql: actions/gateway.ts statements off drizzle except the approval+pending-action transaction (it passes tx to createApproval in approvals/service.ts); same race-safe claims, cancels, audits and denials; tests unchanged"
status: merged
milestone: M5
branch: task/T-0629-effect-sql-action-gateway
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0629: action gateway statements on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is F1 in `docs/audit/effect-last-mile.md` §2 (T-0626), minus one transaction. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive; read lines 100-130 and 440-900)
- **`apps/server/src/actions/gateway.ts`**, drizzle imports at 3 and 7.
- **It stays on drizzle in this task:** the transaction at **478-511**. It passes `tx` to `createApproval` (`apps/server/src/approvals/service.ts`) and inserts the `pending_actions` row on the same `tx`, so it moves when the approvals service moves (C1 in the audit). Leave that block untouched and add a comment above it saying why.
- **These move to effect/sql**, all with the top-level `deps.db` or `db`:
  - `runOnApprovalDecided` (561-696):
    - the pending row by `approval_id` (567-571);
    - the approval row (578-582);
    - the AI status (590-594);
    - the post-verify status read (619-623);
    - the **race-safe claim** (633-637): `UPDATE … SET status = 'running', started_at = … WHERE id = … AND status = 'waiting' RETURNING *`. Exactly one caller may win, so keep the guard and the zero-rows return;
  - `runRecoverStuck` (702-743): the guarded stuck update (`status = 'running' AND started_at < cutoff`, `RETURNING *`), the `waiting` rows, and the per-row approval read;
  - `cancelPending` (751-755) and `finishPending` (789-792): guarded updates on `status = 'waiting'` and `status = 'running'`;
  - `readAiStatus` (836-843), `isAiInGroup` (845-852) and the topic read in `isAiInTopic` (868-878).
- **Rows:**
  - `PendingActionRow` (118) is `typeof pendingActions.$inferSelect`, and `args` is jsonb (T-0614 keeps keys as written);
  - `snakeToCamel` gives camelCase;
  - the code calls `approval.expiresAt.getTime()` (600, 739). Confirm those come back as `Date` from effect/sql, as other converted modules rely on; if not, convert explicitly;
  - no bigint column is involved.
- **Tests that must pass unchanged:**
  - `apps/server/src/actions/*.test.ts` (including `flow.e2e.test.ts` and `recovery-loop.effect.test.ts`);
  - `apps/server/src/approvals/*.test.ts`.

### What to build
1. Move every statement listed above to effect/sql, with the same guards, return checks, audits, announcements and denial reasons. The drizzle imports stay only for the 478-511 transaction.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/actions/gateway.ts`.

### Allowed files
`apps/server/src/actions/gateway.ts`, `work/T-0629-effect-sql-action-gateway.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions src/approvals
pnpm gate
```

### Acceptance
- The gateway's statements run on effect/sql, except the one transaction waiting for the approvals service.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved every statement listed in the spec from drizzle to `effect/sql` in
`apps/server/src/actions/gateway.ts`, keeping the same guards, zero-row
returns, audits, announcements and denial reasons:

- `runOnApprovalDecided`: pending row by `approval_id`, approval
  (`status`, `expires_at`), AI status, post-verify status read, and the
  race-safe `UPDATE … SET status = 'running', started_at = … WHERE id = …
  AND status = 'waiting' RETURNING *` claim.
- `runRecoverStuck`: guarded stuck update (`status = 'running' AND
  started_at < cutoff RETURNING *`), the `waiting` rows, and the per-row
  approval read.
- `cancelPending` and `finishPending`: guarded updates (`waiting` and
  `running`).
- `readAiStatus`, `isAiInGroup`, and the topic read in `isAiInTopic`.

A private `runSql(db, effect)` helper calls `sqlRuntimeFor(db).runPromise`
(same shape as `pins/service.ts`). Rows are read with the schema-inferred
types `AiStatusRow` / `PendingActionRow`; `RETURNING *` and `SELECT *`
return camelCased columns and `timestamptz` as `Date`, so
`approval.expiresAt.getTime()` still works and no explicit conversion was
needed. The `args` jsonb keys are untouched (`transformJson: false`).

**Left on drizzle, with a comment:** the one transaction at what was
478-511 that passes `tx` to `createApproval` and inserts the
`pending_actions` row on the same `tx`. It moves when the approvals service
moves (C1). I added a comment above it saying why.

Dropped the now-unused `drizzle-orm` import and the `approvals`, `groupAis`,
`topics` schema imports; kept `ais` and `pendingActions` for their
`$inferSelect` types (same pattern as the pins pilot). No test files
changed.

### Files changed

- `apps/server/src/actions/gateway.ts`
- `work/T-0629-effect-sql-action-gateway.md` (status/report)

### Commands and results

- `pnpm install`: done, 1173 packages, no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions/gateway.test.ts`: 46 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/actions src/approvals`: 16 files, 257 passed (includes `flow.e2e.test.ts` and `recovery-loop.effect.test.ts`).
- `pnpm gate`: first run FAILed on `format` (prettier on my file); ran
  `pnpm exec prettier --write apps/server/src/actions/gateway.ts`, then:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (15.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (10.2s)
  PASS  tests @zilar/server  (14.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

- None functional. Formatting was the only gate failure and was fixed on the
  allowed file.

### Open questions

- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 1 nit. The packet head is 606b6d10, the current HEAD.
- **Lead check of the SQL:**
  - the claim (`status = waiting` to `running`) keeps its guard, so exactly one caller wins;
  - cancel and finish keep their status guards, and the stuck sweep keeps its cutoff;
  - the 478-511 transaction stays on drizzle until the approvals service moves.
- **Nit, for the cleanup task:** the inline row types should become `Pick<$inferSelect>`.

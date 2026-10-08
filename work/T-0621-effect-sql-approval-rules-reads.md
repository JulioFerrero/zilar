---
id: T-0621
title: "effect/sql: approvals/rules.ts top-level statements (findActiveRule, listActiveRulesForAi/ForTopic, revokeRule, revokeActiveRulesForAiInTopic, isGroupAdmin) off drizzle; createRule, findActiveRuleForUpdate and revokeActiveRulesForAiInGroup stay on drizzle because callers pass a drizzle transaction; same rows, same results; tests unchanged"
status: merged
milestone: M5
branch: task/T-0621-effect-sql-approval-rules-reads
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0621: approval rules statements on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive; read the whole file, 284 lines)
- **Three functions run inside a caller's drizzle transaction and must stay on drizzle in this task:**
  - `createRule` (`apps/server/src/approvals/rules.ts:91`), called with a drizzle `tx` at `apps/server/src/approvals/service.ts:357`;
  - `findActiveRuleForUpdate` (`rules.ts:64`), which `createRule` uses;
  - `revokeActiveRulesForAiInGroup` (`rules.ts:237`), called with a drizzle `tx` at `apps/server/src/groups/service.ts:1090`.

  **Do not change these three, nor their callers.**
- **The rest are called with the top-level `db`** and move to effect/sql:
  - `findActiveRule` (140): `apps/server/src/actions/gateway.ts:256`. Today it delegates to `findActiveRuleForUpdate`; give it its own statement with the same filter. The `topicId === null` case uses `topic_id IS NULL`.
  - `listActiveRulesForAi` (149) and `listActiveRulesForTopic` (162): `approvals/api.ts:437,484`.
  - `revokeRule` (185): `approvals/api.ts:515`. Keep the read, the idempotent already-revoked answer and the guarded `UPDATE … WHERE id = … AND revoked_at IS NULL RETURNING *`. A missing row returns `null`, as today.
  - `revokeActiveRulesForAiInTopic` (216): `apps/server/src/topics/service.ts:919`, top-level `deps.db`. Returns `{ id, action }[]`, as today.
  - `isGroupAdmin` (257): `approvals/api.ts:295,413,468,651` and `approvals/service.ts:320`, all with the top-level `db`. It returns true only for the role `owner` or `admin`.
- **Leave alone:** `apps/server/src/audit/service.ts:415` has its own private `isGroupAdmin`.
- **Rows:** `transformResultNames: snakeToCamel` (`apps/server/src/effect/sql.ts`) gives the camelCase `ApprovalRuleRow`. Keep `ApprovalRuleRow` as a type-only use of `approvalRules.$inferSelect`. Keep every signature, including the `db: ServerDatabase` parameter, and pass it to the private `runSql` the way pins does.
- **Tests that must pass unchanged:**
  - `apps/server/src/approvals/rules.test.ts`;
  - `apps/server/src/approvals/rules.routes.test.ts`;
  - `apps/server/src/actions/gateway.test.ts`;
  - `apps/server/src/topics/*.test.ts`.

### What to build
1. Convert the seven functions listed above as "move", with the same filters, results and `null` answers. The drizzle imports stay only for the three functions that remain on drizzle; add a comment above them saying they stay on drizzle until their callers' transactions move.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `docs/audit/effect-sql-migration.md` §(a), `apps/server/src/pins/service.ts` (lines 150-230) and `apps/server/src/approvals/rules.ts`.

### Allowed files
`apps/server/src/approvals/rules.ts`, `work/T-0621-effect-sql-approval-rules-reads.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/rules src/actions/gateway src/topics
pnpm gate
```

### Acceptance
- The listed functions run on effect/sql with the same behaviour.
- `createRule`, `findActiveRuleForUpdate` and `revokeActiveRulesForAiInGroup` are untouched.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved the top-level approval-rule statements in `apps/server/src/approvals/rules.ts`
off drizzle onto `effect/sql`, following `docs/audit/effect-sql-migration.md` §(a)
and the pins pilot (`apps/server/src/pins/service.ts`):

- Added a private `runSql(db, effect)` helper that runs an effect through
  `sqlRuntimeFor(db).runPromise(effect)`, exactly like pins.
- Converted `findActiveRule`, `listActiveRulesForAi`, `listActiveRulesForTopic`,
  `revokeRule`, `revokeActiveRulesForAiInTopic` and `isGroupAdmin` to the
  `sql<ApprovalRuleRow>` tagged template. Same filters, same results:
  `findActiveRule` has its own `topic_id IS NULL` / `topic_id = …` statements
  (it no longer delegates to `findActiveRuleForUpdate`); `revokeRule` keeps its
  read, idempotent already-revoked answer and guarded
  `UPDATE … WHERE id = … AND revoked_at IS NULL RETURNING *`, and a missing row
  still returns `null`; `revokeActiveRulesForAiInTopic` still returns
  `{ id, action }[]`; `isGroupAdmin` still returns true only for `owner`/`admin`.
- Kept `findActiveRuleForUpdate`, `createRule` and `revokeActiveRulesForAiInGroup`
  on drizzle (their callers pass a drizzle transaction) and added a comment
  above each group saying they stay on drizzle until their callers' transactions
  move. `findActiveRuleForUpdate`, `createRule` and their callers are unchanged.
- Kept every exported signature, including the `ServerDatabase` parameter, and
  kept `ApprovalRuleRow` as a type-only use of `approvalRules.$inferSelect`.
- Removed the now-unused `groupMembers` drizzle import (only `isGroupAdmin`
  used it).
- No test files were touched.

### Files changed

- `apps/server/src/approvals/rules.ts`
- `work/T-0621-effect-sql-approval-rules-reads.md`

### Commands run (real results)

- `pnpm install` — done, 1173 packages, 12.4s. One pre-existing peer warning
  (`apps/mobile` `@types/react-dom` vs `@types/react`), unrelated to this task.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/rules.test.ts`
  — 1 file, 30 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/rules src/actions/gateway src/topics`
  — 5 files, 132 tests passed.
- `pnpm gate` (first run) — `GATE FAIL`: `@zilar/server#typecheck` TS4104,
  `listActiveRulesForTopic` returned the driver's `readonly` row array as a
  mutable `ApprovalRuleRow[]`. Fixed by copying the rows (`return [...rows]`);
  no behaviour change.
- `pnpm gate` (second run) — exit 0, `GATE PASS`:

```
PASS  install (frozen)  (1.1s)
PASS  format  (14.2s)
PASS  lint  (0.4s)
PASS  typecheck  (6.4s)
PASS  tests @zilar/server  (7.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / notes

- The Spec's "What to build" says "seven functions", but the move list names six
  (`findActiveRule`, `listActiveRulesForAi`, `listActiveRulesForTopic`,
  `revokeRule`, `revokeActiveRulesForAiInTopic`, `isGroupAdmin`). I converted all
  six named functions; the three named drizzle-only functions are untouched.
- I kept `revokeActiveRulesForAiInTopic`'s parameter name `tx` (its call site,
  `topics/service.ts:919`, passes the top-level `deps.db`) to keep every
  signature literally unchanged.
- Security: no routes changed; `revokeRule` is still scoped by `id` and the
  update is guarded by `revoked_at IS NULL`; `revokeActiveRulesForAiInTopic` is
  scoped by `(ai_id, topic_id)`; `isGroupAdmin` accepts only `owner`/`admin`.

### Open questions

None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is e62f281b, the current HEAD.
- **Lead check of the diff:**
  - the seven functions use the same filters, including the `topic_id IS NULL` branch;
  - `revokeRule` keeps the guarded UPDATE and its `null` answers;
  - `isGroupAdmin` is true only for owner and admin;
  - the three functions called inside drizzle transactions are untouched and carry comments;
  - only `rules.ts` and this file changed.

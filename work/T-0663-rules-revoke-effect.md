---
id: T-0663
title: "effect/sql phase 1: add revokeActiveRulesForAiInGroupEffect next to the drizzle revokeActiveRulesForAiInGroup in approvals/rules.ts; one test; drizzle version unchanged"
status: merged
milestone: M5
branch: task/T-0663-rules-revoke-effect
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0663: the rules revoke as an Effect

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is phase 1 of the `removeGroupAi` chain (audit items C1, C2 and C5 in `docs/audit/effect-last-mile.md`). `apps/server/src/groups/service.ts:1067-1119` passes its drizzle `tx` into four helpers, so they cannot move until that transaction moves. Phase 1 adds an Effect version of each helper next to the drizzle one. Phase 2, a later task, switches `removeGroupAi` to `sql.withTransaction` with these Effects and deletes the drizzle versions. **Keep the drizzle function exactly as it is in this task.**

### Verified facts (do not re-derive)
- **`apps/server/src/approvals/rules.ts:282-298`:** `revokeActiveRulesForAiInGroup(tx, { aiId, groupId, actorId, now })` sets `revoked_at = now` and `revoked_by = actorId` on `approval_rules` where `ai_id`, `group_id` and `revoked_at IS NULL`. It returns `rows.map(r => ({ id, action }))`. The comment at lines 274-276 explains why it stays on drizzle.
- **The existing runSql** is at `approvals/rules.ts:45`; the file already imports `Effect`, `SqlClient`, `SqlError` and `sqlRuntimeFor` (lines 3-7).
- **`apps/server/src/approvals/rules.test.ts:714-743`** tests the drizzle version: a personal rule stays, the group rule is revoked.
- **The recipe** (already in each target file): a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`, statements written as `` sql<Row>`...` ``, and result names camelCased by the client. Timestamps are written as `${input.now.toISOString()}`, as `routines/service.ts` `deleteRoutinesForTool` does. A list goes in through `sql.in(list)` (see `agents/memory/store.ts:412`), with an early return for an empty list.

### What to build
1. **Export `revokeActiveRulesForAiInGroupEffect(input)`,** with the same input type, returning `Effect.Effect<Array<{ id: string; action: string }>, SqlError.SqlError, SqlClient.SqlClient>`. It runs one `UPDATE approval_rules SET revoked_at = …, revoked_by = … WHERE ai_id = … AND group_id = … AND revoked_at IS NULL RETURNING id, action`.
2. **Update the comment** at lines 274-276 to say the Effect version is for `removeGroupAi` once its transaction moves.
3. **Add one test** in `rules.test.ts`, a copy of the 714-743 test, that runs `sqlRuntimeFor(context.db).runPromise(revokeActiveRulesForAiInGroupEffect({...}))` and makes the same assertions.
4. **Leave `revokeActiveRulesForAiInGroup` unchanged.**

### Read first
`AGENTS.md`, `apps/server/src/approvals/rules.ts` (lines 1-60 and 270-300), `apps/server/src/approvals/rules.test.ts` (lines 1-40 and 700-745).

### Allowed files
`apps/server/src/approvals/rules.ts`, `apps/server/src/approvals/rules.test.ts`, `work/T-0663-rules-revoke-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/rules.test
pnpm gate
```

### Acceptance
- The new test passes, and the existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- Added `revokeActiveRulesForAiInGroupEffect(input)` to `apps/server/src/approvals/rules.ts`, right after the drizzle helper. It returns `Effect.Effect<Array<{ id: string; action: string }>, SqlError.SqlError, SqlClient.SqlClient>` and runs one `UPDATE approval_rules SET revoked_at = …, revoked_by = … WHERE ai_id = … AND group_id = … AND revoked_at IS NULL RETURNING id, action`. `now` is written as `input.now.toISOString()`, matching `routines/service.ts` `deleteRoutinesForTool`. No `sql.in`/empty-list guard is needed because the input is a single `groupId`, not a list.
- Updated the comment above the drizzle `revokeActiveRulesForAiInGroup` to point at the Effect version as the one for `removeGroupAi` once its transaction moves. The drizzle function itself is byte-for-byte unchanged.
- Added one test in `apps/server/src/approvals/rules.test.ts`, a copy of the existing 714-743 test ("kills the AI rules for the group but leaves personal rules alone"), that calls `sqlRuntimeFor(context.db).runPromise(revokeActiveRulesForAiInGroupEffect({ aiId, groupId, actorId: ownerId, now }))` and makes the same assertions: one row revoked, its id matches the group rule, the personal rule's `revokedAt` stays null and the group rule's is set.
- Added imports: `revokeActiveRulesForAiInGroupEffect` from `./rules` and `sqlRuntimeFor` from `../effect/sql`.

### Files changed
- `apps/server/src/approvals/rules.ts`
- `apps/server/src/approvals/rules.test.ts`
- `work/T-0663-rules-revoke-effect.md` (status + this report)

### Commands and results
- `pnpm install`: Done in 12.5s, 1173 packages. Pre-existing warning about an unmet peer `@types/react-dom` in `apps/mobile`; unrelated.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/rules.test`: 1 test file passed, 31 tests passed (0 failed).
- `pnpm gate`: `gate: 3 changed file(s) against main`; `PASS install (frozen) (2.0s)`, `PASS format (24.2s)`, `PASS lint (1.1s)`, `PASS typecheck (14.1s)`, `PASS tests @zilar/server (51.7s)`, `scope: every changed file is inside the Allowed files`, `GATE PASS`.

### Deviations from the spec
None.

### Blocked / needs a decision
None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Pre-review clean, no nits; the packet head is f795ad56, the current HEAD. This is phase 1 of the removeGroupAi chain: the Effect revoke sits next to the unchanged drizzle one, with a faithful test.

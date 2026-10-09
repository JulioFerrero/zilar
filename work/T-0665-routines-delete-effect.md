---
id: T-0665
title: "effect/sql phase 1: add deleteRoutinesForAiInGroupEffect next to the drizzle deleteRoutinesForAiInGroup in routines/service.ts; one test; drizzle version unchanged"
status: merged
milestone: M5
branch: task/T-0665-routines-delete-effect
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0665: the routines group delete as an Effect

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is phase 1 of the `removeGroupAi` chain (audit items C1, C2 and C5 in `docs/audit/effect-last-mile.md`). `apps/server/src/groups/service.ts:1067-1119` passes its drizzle `tx` into four helpers, so they cannot move until that transaction moves. Phase 1 adds an Effect version of each helper next to the drizzle one. Phase 2, a later task, switches `removeGroupAi` to `sql.withTransaction` with these Effects and deletes the drizzle versions. **Keep the drizzle function exactly as it is in this task.**

### Verified facts (do not re-derive)
- **`apps/server/src/routines/service.ts:555-572`:** `deleteRoutinesForAiInGroup(tx, { aiId, groupId, now })` sets `deleted_at` and `updated_at` on `routines` where `ai_id`, `group_id` and `deleted_at IS NULL`, and returns the ids. The comment at lines 551-554 explains why it stays on drizzle.
- **`deleteRoutinesForTool`** (lines 576-591) is the effect/sql model to follow.
- **The existing runSql** is at `routines/service.ts:94`.
- **`apps/server/src/routines/service.test.ts:728-747`** ("removing the AI from the group soft-deletes its routines") covers the drizzle path through `removeGroupAi`.
- **The recipe** (already in each target file): a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`, statements written as `` sql<Row>`...` ``, and result names camelCased by the client. Timestamps are written as `${input.now.toISOString()}`, as `routines/service.ts` `deleteRoutinesForTool` does. A list goes in through `sql.in(list)` (see `agents/memory/store.ts:412`), with an early return for an empty list.

### What to build
1. **Export `deleteRoutinesForAiInGroupEffect(input)`,** with the same input type, returning `Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient>`. Write it like `deleteRoutinesForTool`'s statement, with `ai_id` and `group_id`.
2. **Update the comment** at lines 551-554.
3. **Add one test** in `service.test.ts` that seeds a routine in the group and one elsewhere (follow the seeding in the 728-747 test), runs the Effect with `sqlRuntimeFor(context.db).runPromise(...)`, and asserts that only the group routine is soft-deleted and its id is returned.
4. **Leave the drizzle function unchanged.**

### Read first
`AGENTS.md`, `apps/server/src/routines/service.ts` (lines 85-110 and 545-595), `apps/server/src/routines/service.test.ts` (lines 1-60 and 720-800).

### Allowed files
`apps/server/src/routines/service.ts`, `apps/server/src/routines/service.test.ts`, `work/T-0665-routines-delete-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/service.test
pnpm gate
```

### Acceptance
- The new test passes, and the existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/routines/service.ts`: added `deleteRoutinesForAiInGroupEffect(input)` right after the drizzle `deleteRoutinesForAiInGroup`. It returns `Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient>` and runs `UPDATE routines SET deleted_at, updated_at WHERE ai_id AND group_id AND deleted_at IS NULL RETURNING id`, the same shape as `deleteRoutinesForTool`. Added `SqlError` to the `effect/sql` import.
- Updated the comment above the drizzle function to point at the new Effect version. The drizzle function body is unchanged.
- `apps/server/src/routines/service.test.ts`: added one test, "the effect delete soft-deletes only this AI in this group". It seeds the owner's group routine (via `ownerWithGroupRoutine`) and a second routine for the same AI in a second group (via `seedGroup` and `seedTool`). It runs the Effect with `sqlRuntimeFor(context.db).runPromise(...)` and asserts that the returned ids equal `[group routine id]`, that the group routine is soft-deleted, and that the other-group routine is not. Added imports for `sqlRuntimeFor` and `deleteRoutinesForAiInGroupEffect`.
- Status set to `review`.

### Commands and results
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/routines/service.test`: 1 file passed, 20 tests passed (includes the new test; the existing 728-747 test passes unchanged).
- `pnpm gate` (run from the worktree root, log written to a file and removed afterwards):
  - `gate: 3 changed file(s) against main`
  - `PASS  install (frozen)  (2.0s)`
  - `PASS  format  (44.7s)`
  - `PASS  lint  (1.3s)`
  - `PASS  typecheck  (17.9s)`
  - `PASS  tests @zilar/server  (17.1s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
- None. The spec's `deleteRoutinesForAiInGroupEffect` is exported without a `runSql` wrapper, as the spec's signature describes, so the caller runs it through `sqlRuntimeFor`.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, as a Claude Code subagent, in one round with no fix needed (about 3.5 min). The lead reviewed the diff directly, since this path has no OpenCode pre-review. The statement matches the drizzle version (`ai_id`, `group_id`, `deleted_at IS NULL`, `RETURNING id`). The test proves the other-group routine is kept. The gate passed.

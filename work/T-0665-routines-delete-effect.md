---
id: T-0665
title: "effect/sql phase 1: add deleteRoutinesForAiInGroupEffect next to the drizzle deleteRoutinesForAiInGroup in routines/service.ts; one test; drizzle version unchanged"
status: todo
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

## Review (written by Claude)

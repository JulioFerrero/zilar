---
id: T-0664
title: "effect/sql phase 1: add deleteToolsForAiInGroupEffect and deleteToolsForAiInTopicEffect next to the drizzle versions in tools/service.ts; tests; drizzle versions unchanged"
status: todo
milestone: M5
branch: task/T-0664-tools-deletes-effect
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0664: the tools deletes as Effects

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is phase 1 of the `removeGroupAi` chain (audit items C1, C2 and C5 in `docs/audit/effect-last-mile.md`). `apps/server/src/groups/service.ts:1067-1119` passes its drizzle `tx` into four helpers, so they cannot move until that transaction moves. Phase 1 adds an Effect version of each helper next to the drizzle one. Phase 2, a later task, switches `removeGroupAi` to `sql.withTransaction` with these Effects and deletes the drizzle versions. **Keep the drizzle function exactly as it is in this task.**

### Verified facts (do not re-derive)
- **`apps/server/src/tools/service.ts:614-631`:** `deleteToolsForAiInTopic(tx, { aiId, topicId, now })` sets `deleted_at = now` and `updated_at = now` on `ai_tools` where `ai_id`, `topic_id` and `deleted_at IS NULL`, and returns the ids.
- **`apps/server/src/tools/service.ts:636-653`:** `deleteToolsForAiInGroup(tx, { aiId, groupId, now })` does the same with `group_id`.
- **The comments** at lines 610-613 and 632-635 explain why both stay on drizzle.
- **The existing runSql** is at `tools/service.ts:130`.
- **`apps/server/src/tools/service.test.ts:782-830`** tests `deleteToolsForAiInGroup` through `context.db.transaction(rawTx => …)`.
- **The recipe** (already in each target file): a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`, statements written as `` sql<Row>`...` ``, and result names camelCased by the client. Timestamps are written as `${input.now.toISOString()}`, as `routines/service.ts` `deleteRoutinesForTool` does. A list goes in through `sql.in(list)` (see `agents/memory/store.ts:412`), with an early return for an empty list.

### What to build
1. **Export `deleteToolsForAiInGroupEffect(input)` and `deleteToolsForAiInTopicEffect(input)`,** with the same input types, each returning `Effect.Effect<string[], SqlError.SqlError, SqlClient.SqlClient>`. Each runs one `UPDATE ai_tools … RETURNING id` and maps to the ids.
2. **Update the two comments** to name the Effect versions.
3. **Add two tests** in `service.test.ts`, modelled on the 782-830 test, that run each Effect with `sqlRuntimeFor(context.db).runPromise(...)` and assert that only the matching tool is soft-deleted.
4. **Leave both drizzle functions unchanged.**

### Read first
`AGENTS.md`, `apps/server/src/tools/service.ts` (lines 120-140 and 600-655), `apps/server/src/tools/service.test.ts` (lines 1-40 and 780-870).

### Allowed files
`apps/server/src/tools/service.ts`, `apps/server/src/tools/service.test.ts`, `work/T-0664-tools-deletes-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/tools/service.test
pnpm gate
```

### Acceptance
- The new tests pass, and the existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

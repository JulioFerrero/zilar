---
id: T-0666
title: "effect/sql phase 1: add deleteRoomMemoryEffect next to the drizzle deleteRoomMemory in agents/memory/store.ts; one test; drizzle version unchanged"
status: merged
milestone: M5
branch: task/T-0666-room-memory-delete-effect
model: auto
effort: low
depends_on: []
estimate: 0.1 day
---

# T-0666: the room-memory delete as an Effect

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is phase 1 of the `removeGroupAi` chain (audit items C1, C2 and C5 in `docs/audit/effect-last-mile.md`). `apps/server/src/groups/service.ts:1067-1119` passes its drizzle `tx` into four helpers, so they cannot move until that transaction moves. Phase 1 adds an Effect version of each helper next to the drizzle one. Phase 2, a later task, switches `removeGroupAi` to `sql.withTransaction` with these Effects and deletes the drizzle versions. **Keep the drizzle function exactly as it is in this task.**

### Verified facts (do not re-derive)
- **`apps/server/src/agents/memory/store.ts:530-575`:** `deleteRoomMemory(db, aiId, roomLocalparts)` builds the prefixes `room:<localpart>` (deduplicated) and returns early for an empty list. It then deletes, in this order, from `ai_memory_messages`, `ai_memory_nodes`, `ai_memory_facts` and `ai_memory_state`, each `WHERE ai_id = aiId AND split_part(chat_key, '@', 1) IN (prefixes)`. The comment at lines 520-529 explains why it stays on drizzle.
- **The existing runSql** is at `store.ts:58`. `sql.in` is already used at `store.ts:412`.
- **`apps/server/src/agents/memory/cleanup.test.ts:240-264`** tests the drizzle version: one AI and only the named rooms; an empty list does nothing.
- **The recipe** (already in each target file): a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise(effect)`, statements written as `` sql<Row>`...` ``, and result names camelCased by the client. Timestamps are written as `${input.now.toISOString()}`, as `routines/service.ts` `deleteRoutinesForTool` does. A list goes in through `sql.in(list)` (see `agents/memory/store.ts:412`), with an early return for an empty list.

### What to build
1. **Export `deleteRoomMemoryEffect(aiId, roomLocalparts)`,** returning `Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>`. It uses the same prefixes, the same empty-list return, and the same four deletes in the same order.
2. **Update the comment** at lines 520-529.
3. **Add two tests** in `cleanup.test.ts`, copies of the 240-264 tests, that run the Effect with `sqlRuntimeFor(context.db).runPromise(...)` and make the same assertions.
4. **Leave `deleteRoomMemory` unchanged.**

### Read first
`AGENTS.md`, `apps/server/src/agents/memory/store.ts` (lines 1-70, 400-415 and 515-576), `apps/server/src/agents/memory/cleanup.test.ts` (lines 1-60 and 235-266).

### Allowed files
`apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/cleanup.test.ts`, `work/T-0666-room-memory-delete-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory/cleanup
pnpm gate
```

### Acceptance
- The new tests pass, and the existing tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
- `apps/server/src/agents/memory/store.ts`: added `deleteRoomMemoryEffect(aiId, roomLocalparts)` after `deleteRoomMemory`. It returns `Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>`, builds the same `room:<localpart>` prefixes (deduplicated), returns early for an empty list, and runs the same four deletes in the same order (`ai_memory_messages`, `ai_memory_nodes`, `ai_memory_facts`, `ai_memory_state`), each scoped by `ai_id` and `split_part(chat_key, '@', 1) IN ${sql.in(prefixes)}`. The client is taken with `yield* SqlClient.SqlClient`, the same pattern as `addFact` (`store.ts:393`), so the drizzle `sql` import is shadowed inside the function only.
- Updated the comment above `deleteRoomMemory` to point at the Effect version. `deleteRoomMemory` is unchanged.
- `apps/server/src/agents/memory/cleanup.test.ts`: imported `sqlRuntimeFor` and `deleteRoomMemoryEffect`, and added two tests after the drizzle pair: "deleteRoomMemoryEffect deletes only one AI and only the named rooms" and "deleteRoomMemoryEffect does nothing for an empty list". They run the Effect through `sqlRuntimeFor(context.db).runPromise(...)` and make the same assertions as the drizzle tests.
- Drizzle version and `drizzle-orm` version unchanged. No dependencies added.

### Files changed
- `apps/server/src/agents/memory/store.ts`
- `apps/server/src/agents/memory/cleanup.test.ts`
- `work/T-0666-room-memory-delete-effect.md` (status and this Report)

### Commands and results
- `pnpm install`: done (37.9s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/agents/memory/cleanup` (the single test file): 1 file passed, 6 tests passed (the existing tests and the two new Effect tests).
- `pnpm gate` (from the worktree root, log kept in the scratchpad): exit 0.
  - `PASS install (frozen) (2.2s)`
  - `PASS format (43.5s)`
  - `PASS lint (1.3s)`
  - `PASS typecheck (18.0s)`
  - `PASS tests @zilar/server (16.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems / deviations
- None. The spec's column and table names match `apps/server/src/db/schema.ts` (`ai_memory_messages`, `ai_memory_nodes`, `ai_memory_facts`, `ai_memory_state`, with `ai_id` and `chat_key`).
- The early return for an empty list sits inside `Effect.gen`, before the client is read. It issues no query in that case, which matches the drizzle version.

### Blocked / needs a decision
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, as a Claude Code subagent, in one round with no fix needed (about 3.5 min). The lead reviewed the diff directly. It keeps the same prefixes, the same empty-list return (no query), the same four deletes in the same order, and `sql.in`. Both test copies make real assertions. The gate passed.

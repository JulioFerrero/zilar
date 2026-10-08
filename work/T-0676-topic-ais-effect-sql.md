---
id: T-0676
title: "effect/sql: move the topic-AI functions in topics/service.ts (emitDroppedTopicAis, addTopicAi, removeTopicAi) onto effect/sql; removeTopicAi uses deleteToolsForAiInTopicEffect and deleteRoomMemoryEffect"
status: todo
milestone: M5
branch: task/T-0676-topic-ais-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0676: topic AIs on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. `topics/service.ts` is all drizzle, and this is its first slice: the three topic-AI functions. They are also the last callers of the drizzle `deleteToolsForAiInTopic` and `deleteRoomMemory`.

### Verified facts (do not re-derive)
- **`apps/server/src/topics/service.ts`:**
  - `emitDroppedTopicAis(deps, topic)` (line 659) returns early for General or archived topics. Otherwise it selects `topic_ais.ai_id`, `ais.owner` and `ais.status` (`topic_ais` inner join `ais` on `ais.id = topic_ais.ai_id`) where `topic_id = topic.id`, then calls `aiMayBeInTopic` for each row;
  - `addTopicAi(deps, input)` (line 815) uses three drizzle statements: the AI select (`id, owner, status` from `ais` where `id`, `LIMIT 1`), the `group_ais` check (`group_id`, `ai_id`, `LIMIT 1`), and the insert `topic_ais (topic_id, ai_id, added_by)` with `ON CONFLICT DO NOTHING`. It then re-reads the topic (`select().from(topics).where(id)`);
  - `removeTopicAi(deps, topicId, actorId, aiId)` (line 878) uses the `topic_ais` existence select, the AI select (`id, owner`), and the `topic_ais` delete. Then, in order, it runs `revokeActiveRulesForAiInTopic(deps.db, …)`, `deleteToolsForAiInTopic(deps.db, …)` (line 920, drizzle), `deleteRoutinesForAiInTopic(deps.db, …)` and `deleteRoomMemory(deps.db, aiId, [topic.roomLocalpart])` (line 924, drizzle), and finally re-reads the topic.
- **The topic re-read** returns `TopicRow` (`typeof topics.$inferSelect`, `topics/access.ts:31`). `getTopic(db, id)` (`topics/access.ts:95`, already imported at `service.ts:27`) returns the same row and is already used for re-reads (`service.ts:613`). Use it.
- **The Effect versions to call:** `deleteToolsForAiInTopicEffect` (`apps/server/src/tools/service.ts`) and `deleteRoomMemoryEffect` (`apps/server/src/agents/memory/store.ts`), run with `sqlRuntimeFor(deps.db).runPromise(...)`. `revokeActiveRulesForAiInTopic` and `deleteRoutinesForAiInTopic` already take a db and stay as they are.
- **The recipe:** a private `runSql(db, effect)` that calls `sqlRuntimeFor(db).runPromise` (copy `apps/server/src/ais/service.ts:27-32`), with statements written as `` sql<Row>`…` `` and camelCased result names.
- **Tests:** `apps/server/src/topics/topics.test.ts:661-1100` ("topic AIs (T-0109)").

### What to build
1. **Add `runSql`** to `topics/service.ts`.
2. **Rewrite the drizzle statements** in `emitDroppedTopicAis`, `addTopicAi` and `removeTopicAi` with effect/sql, keeping the same filters, the same order and every error and text. Use `getTopic(deps.db, topic.id)` for the re-reads, keeping the `if (!updated) throw toMissingTopic()`.
3. **In `removeTopicAi`,** call the two Effects instead of the drizzle `deleteToolsForAiInTopic` and `deleteRoomMemory`, in the same position. Update the imports.
4. **Change no other function in the file,** and keep the drizzle imports the rest of the file still needs.

### Read first
`AGENTS.md`, `apps/server/src/topics/service.ts` (lines 1-60, 650-945), `apps/server/src/topics/access.ts` (lines 25-110).

### Allowed files
`apps/server/src/topics/service.ts`, `work/T-0676-topic-ais-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/topics.test
pnpm gate
```

### Acceptance
- The three functions have no drizzle calls.
- The topics tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

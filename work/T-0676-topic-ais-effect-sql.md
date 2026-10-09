---
id: T-0676
title: "effect/sql: move the topic-AI functions in topics/service.ts (emitDroppedTopicAis, addTopicAi, removeTopicAi) onto effect/sql; removeTopicAi uses deleteToolsForAiInTopicEffect and deleteRoomMemoryEffect"
status: merged
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

**What I did**
- `apps/server/src/topics/service.ts`:
  - Added a private `runSql(db, effect)` (copied from `ais/service.ts`) above `emitDroppedTopicAis`.
  - `emitDroppedTopicAis`, `addTopicAi` and `removeTopicAi` now run their statements as `sql` template queries on `effect/sql`. Filters, order, errors and texts are unchanged.
  - The topic re-reads use `getTopic(deps.db, id)` with the same `if (!updated) throw toMissingTopic()`.
  - `removeTopicAi` calls `deleteToolsForAiInTopicEffect` and `deleteRoomMemoryEffect` in the same position as the drizzle versions.
  - Imports: added `Effect`, `SqlClient`/`SqlError`, `sqlRuntimeFor`. Swapped `deleteRoomMemory` and `deleteToolsForAiInTopic` for their Effect versions. Removed `groupAis` and `topicAis` from the drizzle schema import, because lint flagged them as unused after the rewrite. `ais` and `sql` stay (still used elsewhere in the file).
- No other function was changed.
- Checked: `grep` finds no drizzle `select`/`insert`/`delete` left in the three functions. The remaining `deps.db` uses there are the helpers the spec keeps (`aiMayBeInTopic`, `canManageTopic`, `revokeActiveRulesForAiInTopic`, `deleteRoutinesForAiInTopic`).

**Commands and results**
- `pnpm install`: exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics/topics.test`: 1 file passed, 32 tests passed, 0 failed. No test file was edited and none mocks drizzle.
- First `pnpm gate`: GATE FAIL at lint (`groupAis`, `topicAis` unused). Fixed by removing those two imports.
- Final `pnpm gate` (exit 0):
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`
  - The gate reported 2 changed files against main: `apps/server/src/topics/service.ts` and the task file.

**Deviations, problems, open questions**
- None against the spec. I did not run the whole server test suite, only the topics file and the gate's nearest tests.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 3.4 min). The lead reviewed the diff directly.
- **Result:** the three functions have the same filters and order. The re-reads go through `getTopic`, and `removeTopicAi` now uses `deleteToolsForAiInTopicEffect` and `deleteRoomMemoryEffect`. The drizzle `deleteToolsForAiInTopic` and `deleteRoomMemory` now have no production caller, so they are deleted in the cleanup task. The topics tests (32) and the gate passed.

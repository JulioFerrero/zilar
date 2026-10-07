---
id: T-0442
title: "AI memory M4b (server): removing an AI from a group or topic deletes its memory of those rooms"
status: merged
milestone: M5
branch: task/T-0442-ai-memory-room-cleanup
model: auto
effort: low
depends_on: [T-0438]
estimate: 0.3 day
---

# T-0442: AI memory — cleanup when the AI leaves a room

## Spec (written by Claude, do not edit)

### Why
Plan `docs/audit/ai-memory-plan.md` §3.5 and §5 (Julio accepted): removing the AI from a room deletes that room's memory at once. Deleting the AI already cascades every memory table (T-0433).

### Verified facts (do not re-derive)
- **Room memory key:** `room:<room JID>` (`apps/server/src/agents/gateway.ts:1432`), where the room JID is `<roomLocalpart>@<muc domain>`. Room localparts are unique: `groups.roomLocalpart` (`apps/server/src/db/schema.ts:220`) and `topics.roomLocalpart` (`schema.ts:355`).
- **The four tables** `aiMemoryMessages`, `aiMemoryNodes`, `aiMemoryFacts` and `aiMemoryState` each have `aiId` and `chatKey` (`schema.ts`).
- **`removeGroupAi`** (`apps/server/src/groups/service.ts:918`):
  - it runs one `db.transaction` (from about line 952);
  - it deletes the `groupAis` row, then selects the group's topics (`select({ id: topics.id })`, about lines 962-965) and deletes their `topicAis` rows;
  - it then calls cleanup helpers with `tx as unknown as ServerDatabase` (`revokeActiveRulesForAiInGroup`, `deleteToolsForAiInGroup`, `deleteRoutinesForAiInGroup`);
  - `group` (with `roomLocalpart`) is loaded at line 923.
- **`removeTopicAi`** (`apps/server/src/topics/service.ts:955`): deletes the `topicAis` row (about line 991), then calls `revokeActiveRulesForAiInTopic`, `deleteToolsForAiInTopic` and `deleteRoutinesForAiInTopic`. `topic.roomLocalpart` is available.
- **The test pattern to copy:** `apps/server/src/routines/service.test.ts:728-800`, which calls `removeGroupAi` and `removeTopicAi` directly with a fake `adminClient`. Its local helpers are `seedGroup` (line 64) and `ownerWithAi` (line 181).

### What to build
1. **`apps/server/src/agents/memory/store.ts`:** export `deleteRoomMemory(db: ServerDatabase, aiId: string, roomLocalparts: string[]): Promise<void>`.
   - It does nothing for an empty list.
   - Otherwise it deletes, for that `aiId` only, every row in the four memory tables whose `chatKey` is `room:<localpart>@<anything>` for one of the localparts. Match with `split_part(chat_key, '@', 1) IN ('room:<lp>', …)` through drizzle `sql` with bound values, never string-built SQL.
   - Rows of other AIs, DMs and other rooms stay.
2. **`removeGroupAi`:**
   - inside the same transaction, extend the topics select to also take `roomLocalpart`;
   - after the cleanup helpers, call `deleteRoomMemory(tx as unknown as ServerDatabase, input.aiId, [group.roomLocalpart, ...topic room localparts])`, with duplicates removed.
3. **`removeTopicAi`:** after the routines cleanup, call `deleteRoomMemory(deps.db, aiId, [topic.roomLocalpart])`.
4. **New `apps/server/src/agents/memory/cleanup.test.ts`** (copy the helpers it needs from `routines/service.test.ts`):
   - **`deleteRoomMemory`:** seed rows in all four tables for the AI in room A, room B and its DM, and for another AI in room A. Deleting room A removes only the first AI's room A rows.
   - **`removeGroupAi`** deletes the AI's memory of the group's room and of its topic rooms, and keeps its DM memory.
   - **`removeTopicAi`** deletes only that topic room's memory.

### Read first
`AGENTS.md`, `docs/audit/ai-memory-plan.md` §3.5, `apps/server/src/agents/memory/store.ts:1-60`, `apps/server/src/groups/service.ts:915-1000`, `apps/server/src/topics/service.ts:950-1000`, `apps/server/src/routines/service.test.ts:1-200` and `:728-800`.

### Allowed files
`apps/server/src/agents/memory/store.ts`, `apps/server/src/agents/memory/cleanup.test.ts`, `apps/server/src/groups/service.ts`, `apps/server/src/topics/service.ts`, `work/T-0442-ai-memory-room-cleanup.md`.

If any other test breaks, stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/cleanup routines/service groups topics
pnpm gate
```

### Acceptance
- Removing an AI from a group or a topic deletes its memory of exactly those rooms, in the same step; nothing else is touched.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Status: done, all checks green.

### What I did
- `apps/server/src/agents/memory/store.ts`: added and exported
  `deleteRoomMemory(db, aiId, roomLocalparts)`. It returns early for an empty
  list; otherwise deletes, for that `aiId` only, every row in
  `aiMemoryMessages`, `aiMemoryNodes`, `aiMemoryFacts` and `aiMemoryState`
  whose chat key matches `room:<localpart>@<anything>` for one of the given
  localparts. Matching uses drizzle `sql` with bound values via `sql.join`
  (`split_part(chat_key, '@', 1) IN (<bound list>)`), never string-built SQL.
  The list is de-duplicated. Rows of other AIs, DMs and other rooms are left
  alone.
- `apps/server/src/groups/service.ts`: imported `deleteRoomMemory`; the
  topics select inside the `removeGroupAi` transaction now also reads
  `roomLocalpart`; after the rules/tools/routines cleanup helpers, the same
  transaction calls `deleteRoomMemory(tx as unknown as ServerDatabase,
  input.aiId, [...])` with the group room plus every topic room, de-duplicated.
- `apps/server/src/topics/service.ts`: imported `deleteRoomMemory`; after the
  routines cleanup in `removeTopicAi`, it calls
  `deleteRoomMemory(deps.db, aiId, [topic.roomLocalpart])`.
- `apps/server/src/agents/memory/cleanup.test.ts` (new): 4 tests — direct
  `deleteRoomMemory` scoping (only the named AI and named room; room B, the DM
  and another AI's rows in room A survive), empty-list no-op, `removeGroupAi`
  (group room + general topic room + private topic room cleared, DM kept), and
  `removeTopicAi` (only that topic room cleared, group room and DM kept). Each
  test seeds one row in all four memory tables and counts the four tables
  after the operation.

### Files changed
- `apps/server/src/agents/memory/store.ts`
- `apps/server/src/agents/memory/cleanup.test.ts` (new)
- `apps/server/src/groups/service.ts`
- `apps/server/src/topics/service.ts`
- `work/T-0442-ai-memory-room-cleanup.md` (this file)

All five are inside the task's Allowed files.

### Commands run (real results)
- `pnpm install`: succeeded (Done in 18.7s); only pre-existing peer-dep
  warnings.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/cleanup`:
  1 file passed, 4 tests passed. (First run had 2 failures from wrong relative
  dynamic-import paths in my new test; fixed to `../../groups/service` and
  `../../topics/service`.)
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot memory/cleanup routines/service groups topics`:
  6 test files passed, 122 tests passed.
- `pnpm gate` (final):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.2s)
  PASS  format  (23.9s)
  PASS  lint  (0.8s)
  PASS  typecheck  (10.5s)
  PASS  tests @zilar/server  (313.6s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  (An earlier gate run failed on format in my two files and then on an unused
  `owner` variable in the new test; both fixed in scope before the passing run.)

### Problems, deviations, open questions
- None. The spec was implemented as written. The delete runs inside the same
  `removeGroupAi` transaction and in `removeTopicAi` right after the routines
  cleanup, so a removal never leaves room memory behind.

## Review (written by Claude)

Approved (lead, 2026-10-06). deleteRoomMemory removes one AI's rows in all four memory tables whose chat key starts with room:<localpart>@ (bound values, split_part). removeGroupAi calls it in its transaction for the group room and every topic room; removeTopicAi calls it for that topic. DM memory and other AIs stay. Nit accepted: removeTopicAi has no transaction, the same as its other cleanups.

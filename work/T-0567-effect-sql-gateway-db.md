---
id: T-0567
title: "effect/sql: agents/gateway/db.ts (loadActiveAi, loadOwnerName, listAiRooms, loadRoomGateState) drops drizzle for effect/sql through sqlRuntimeFor; same signatures, same results and order; tests unchanged"
status: todo
milestone: M5
branch: task/T-0567-effect-sql-gateway-db
model: auto
effort: low
depends_on: [T-0562]
estimate: 0.5 day
---

# T-0567: gateway db helpers on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. The recipe is in `docs/EFFECT_GUIDE.md`, "Moving a server service onto effect/sql". The closest example is `apps/server/src/ais/usage.ts` (T-0548): a local `runSql(db, effect)` helper over `sqlRuntimeFor(db).runPromise`, at lines 34-39.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/gateway/db.ts`** (178 lines) has four exported async functions, all taking `db: ServerDatabase`:
  - **`loadActiveAi(db, aiId)`** (line 19) selects `id, jid, localpart, owner, name, persona` from `ais` where `id = aiId AND status = 'active'`, `LIMIT 1`. It returns the row or `null`.
  - **`loadOwnerName(db, ownerId)`** (38) selects `name` from the `user` table. **`user` is a reserved word in Postgres, so quote it: `"user"`.** It returns the trimmed name, or `'owner'` when the row is missing or the name is blank.
  - **`listAiRooms(db, aiId)`** (52):
    1. Reads the `group_ais` rows joined to `groups` (`groupId`, `roomLocalpart`).
    2. Returns `[]` early when there are none.
    3. Reads the topics of those groups (`id, groupId, roomLocalpart, visibility, isGeneral, archivedAt`) and the `topic_ais` rows of the AI.
    4. Calls **`allowedTopicAiIds(db, topic)`** from `apps/server/src/topics/access.ts:384` for each non-General, non-archived topic the AI is in. **Keep that call as is**: it is another module, and it stays drizzle for now.
    5. Builds the result in the same order: topic rooms first, in `topicRows` order, then one General per group row, falling back to `{ topicId: '', roomLocalpart: group.roomLocalpart }`.
    
    For a `WHERE group_id IN (...)`, use `sql.in(...)` or `= ANY(...)`, whichever the existing effect/sql modules use (check with grep).
  - **`loadRoomGateState(db, groupId, domain, topicId)`** (144):
    1. Reads the group, and returns `null` when it is missing.
    2. Reads the topic. **Only `id`, `isGeneral` and `visibility` are used**, so select those columns instead of `SELECT *`.
    3. Reads the `topic_members` user ids for a private non-General topic.
    4. Reads the `group_members` (`userId`, `role`) of the group.
    5. Builds the same sets and maps.
- **SQL names:** the tables are `ais`, `"user"`, `groups`, `group_members`, `group_ais`, `topics`, `topic_members` and `topic_ais`. The columns are snake_case (`group_id`, `ai_id`, `topic_id`, `user_id`, `room_localpart`, `is_general`, `archived_at`). Rows come back camelCased through `transformResultNames` (`apps/server/src/effect/sql.ts`).
- **Callers, which stay unchanged:**
  - `gateway/dm-turn.ts:101,185`;
  - `gateway/group-turn.ts:123,132,421`;
  - `gateway/lifecycle.ts:118,160,184`;
  - `gateway/sessions.ts:202`.
  
  They all pass `deps.db`, and none passes a transaction handle.
- **The runtime is registered** by `createApp` (`apps/server/src/app.ts:251`) and by `createTestContext` (`apps/server/src/test-support.ts:310`). `apps/server/src/agents/gateway.test.ts:434` uses `createTestContext`.
- **Tests (all unchanged):**
  - `apps/server/src/agents/gateway.test.ts`;
  - `apps/server/src/agents/integration.test.ts`;
  - `apps/server/src/agents/reply.test.ts`;
  - `apps/server/src/actions/gateway.test.ts`;
  - `apps/server/src/actions/flow.e2e.test.ts`.

  If a test reaches these functions with a database that has no registered runtime ("No effect/sql runtime registered"), stop and report BLOCKED with the test name.

### What to build
1. **Rewrite the four functions in `apps/server/src/agents/gateway/db.ts` with effect/sql:**
   - keep the same exported names, parameters, return types and results, the same early returns and the same output order;
   - add a local `runSql` helper exactly like `ais/usage.ts:34-39`;
   - leave no `drizzle-orm` import and no `../../db/schema` table import in the file. Type-only imports (`ServerDatabase`, `GroupRole`, `ActiveAiForGateway`) stay.
2. **Row typing:**
   - give each query an explicit row interface;
   - `role` is the `GroupRole` string;
   - `archivedAt` is only checked against `null`.
3. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/ais/usage.ts`, `apps/server/src/effect/sql.ts`, `apps/server/src/agents/gateway/db.ts` (all of it) and `apps/server/src/topics/access.ts` (lines 380-400).

### Allowed files
`apps/server/src/agents/gateway/db.ts`, `work/T-0567-effect-sql-gateway-db.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/integration agents/reply actions/gateway actions/flow
pnpm gate
```

### Acceptance
- The gateway db helpers run on effect/sql with the same results and order, and no drizzle.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-0567
title: "effect/sql: agents/gateway/db.ts (loadActiveAi, loadOwnerName, listAiRooms, loadRoomGateState) drops drizzle for effect/sql through sqlRuntimeFor; same signatures, same results and order; tests unchanged"
status: merged
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

### What I did
Rewrote all four exported helpers in `apps/server/src/agents/gateway/db.ts` on `effect/sql`, per the recipe in `docs/EFFECT_GUIDE.md` and the worked example `apps/server/src/ais/usage.ts`:

- Added a local `runSql<A>(db, effect)` over `sqlRuntimeFor(db).runPromise(effect)`.
- `loadActiveAi`: `` sql<ActiveAiForGateway>`SELECT id, jid, localpart, owner, name, persona FROM ais WHERE id = ${aiId} AND status = 'active' LIMIT 1` ``, returns `row ?? null`.
- `loadOwnerName`: `` sql<OwnerNameRow>`SELECT name FROM "user" WHERE id = ${ownerId} LIMIT 1` `` plus the same trim / `'owner'` fallback. `"user"` is quoted as a Postgres reserved word.
- `listAiRooms`: group rows (`group_ais` joined to `groups`), early `[]`, topic rows with `WHERE group_id IN ${sql.in(groupIds)}`, `topic_ais` rows, then `allowedTopicAiIds(db, topic)` unchanged for each non-General non-archived topic the AI is in, and the same output order (topic rooms in `topicRows` order, then one General per group row with the `{ topicId: '', roomLocalpart: group.roomLocalpart }` fallback).
- `loadRoomGateState`: group existence, topic narrowed to `id, is_general, visibility`, `topic_members` for a private non-General topic, `group_members` (`user_id, role`), same sets/maps and same bare-JID/role building.
- Added an explicit row interface per query; `role` is typed `GroupRole`, `archivedAt` is `Date | null` (only checked against `null`).
- Removed all `drizzle-orm` and `../../db/schema` imports. Remaining imports are type-only (`ActiveAiForGateway`, `ServerDatabase`, `GroupRole`) plus `allowedTopicAiIds`, `jidFor`/`localpartFor`, `normBareJid`. Callers and tests untouched.

Only the Allowed files changed: `apps/server/src/agents/gateway/db.ts` and this task file.

### Commands run (real results)
- `pnpm install` — `Done in 39.2s`, exit 0.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/integration agents/reply actions/gateway actions/flow` — `Test Files 5 passed | 1 skipped (6)`, `Tests 283 passed | 1 skipped (284)`, exit 0.
- `pnpm gate` (from repo root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (6.5s)
  PASS  format  (120.4s)
  PASS  lint  (2.2s)
  PASS  typecheck  (55.6s)
  PASS  tests @zilar/server  (227.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- `loadRoomGateState`'s group lookup gained `LIMIT 1` (was un-limited in the drizzle version); `groups.id` is the primary key so the result is identical.
- `generals` map uses `[row.groupId, row] as const` for the tuple type; values and order are unchanged.
- Nothing reached BLOCKED: `createTestContext` registers the runtime, so no "No effect/sql runtime registered" error occurred.

### Open questions
None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, 0 findings, at HEAD 73eaedec.
- **Only `gateway/db.ts` changed;** no test file changed.
- **Lead check:** the lead read every SQL statement against the drizzle version on main. The same tables, filters, `LIMIT 1` and order hold; `"user"` is quoted; and the topic read in the gate is narrowed to the 3 columns it uses.
- **Tests:** 283 passed, and the gate passed at the worker.

---
id: T-0583
title: "effect/sql: the last inline drizzle reads in the agent gateway (live.ts owner/room lookups, listener.ts group listener settings + topic isGeneral, dm-turn.ts virtual key read) and listener/score.ts loadRoster move to effect/sql helpers in gateway/db.ts; same results; tests unchanged"
status: merged
milestone: M5
branch: task/T-0583-effect-sql-gateway-inline-queries
model: auto
effort: low
depends_on: [T-0567]
estimate: 0.5 day
---

# T-0583: the last drizzle reads in the agent gateway

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. T-0567 moved `apps/server/src/agents/gateway/db.ts` to effect/sql, with its local `runSql` and four helpers. Four other files still run small drizzle selects inline. **Move each into a named effect/sql helper with the same result.**

### Verified facts (do not re-derive)
1. **`apps/server/src/agents/gateway/live.ts:139-174`** has three local lookups on `deps.db`:
   - `loadOwnerId(aiId)`: `SELECT owner FROM ais WHERE id = $1 LIMIT 1`, returning `owner` or `null`;
   - `loadRoomJid(groupId)`: `SELECT room_localpart FROM groups WHERE id = $1 LIMIT 1`; missing gives `null`, else `roomJidFor(...)`;
   - `loadTopicRoomJid(topicId)`: `SELECT room_localpart, archived_at FROM topics WHERE id = $1 LIMIT 1`; missing or archived gives `null`.
2. **`apps/server/src/agents/gateway/listener.ts:138-154`:**
   - `SELECT listener_enabled, listener_eagerness FROM groups WHERE id = $1 LIMIT 1`; missing or not enabled means return;
   - then `SELECT is_general FROM topics WHERE id = $1 LIMIT 1`.
   
   `listener_eagerness` is `'quiet' | 'normal' | 'eager'` (`db/schema.ts:259`).
3. **`apps/server/src/agents/gateway/dm-turn.ts:162-166`:** `SELECT encrypted_key FROM llm_virtual_keys WHERE ai_id = $1 LIMIT 1`; missing throws ``AI ${id} has no virtual key``. That throw stays in `dm-turn.ts`. **The decrypted key is never logged.**
4. **`apps/server/src/agents/listener/score.ts:46-62`, `loadRoster(db, input)`:**
   - with `topicId`: `SELECT a.id, a.name, a.persona FROM topic_ais ta JOIN ais a ON a.id = ta.ai_id WHERE ta.topic_id = $1`;
   - else the same through `group_ais` by `group_id`;
   - the JS mapping and the sort stay unchanged.
- **The helpers live in `apps/server/src/agents/gateway/db.ts`**, using its `runSql`, with one exported function per query and explicit row types:
  - `loadAiOwnerId`;
  - `loadGroupRoomLocalpart`;
  - `loadTopicRoomRow` (`roomLocalpart`, `archivedAt`);
  - `loadGroupListenerSettings`;
  - `loadTopicIsGeneral`;
  - `loadEncryptedVirtualKey`.
  
  `loadRoster` stays in `score.ts`, with its own local `runSql`, because `score.ts` must not import from the gateway. All callers pass `deps.db`, with no transaction.
- **When done, none of the four files imports `drizzle-orm` or `db/schema`.** Type-only imports are fine.
- **Tests (all unchanged):**
  - `apps/server/src/agents/gateway.test.ts`;
  - `apps/server/src/agents/listener/score.test.ts` (uses `createTestContext`, which registers the runtime);
  - `apps/server/src/agents/integration.test.ts`;
  - `apps/server/src/agents/reply.test.ts`;
  - `apps/server/src/actions/gateway.test.ts`.

### What to build
1. Add the helpers to `gateway/db.ts`.
2. Replace the inline drizzle in `live.ts`, `listener.ts` and `dm-turn.ts` with calls to the helpers. **Same control flow, nulls and throws.**
3. Rewrite `loadRoster` with effect/sql.
4. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/agents/gateway/db.ts`, the four source locations above, and `apps/server/src/ais/usage.ts:34-39`.

### Allowed files
`apps/server/src/agents/gateway/db.ts`, `apps/server/src/agents/gateway/live.ts`, `apps/server/src/agents/gateway/listener.ts`, `apps/server/src/agents/gateway/dm-turn.ts`, `apps/server/src/agents/listener/score.ts`, `work/T-0583-effect-sql-gateway-inline-queries.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/listener agents/integration agents/reply actions/gateway
pnpm gate
```

### Acceptance
- The four files have no drizzle, and the gateway reads run on effect/sql with the same results.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

Did: moved the last inline drizzle reads in the agent gateway to effect/sql.
- `gateway/db.ts`: added `loadAiOwnerId`, `loadGroupRoomLocalpart`, `loadTopicRoomRow` (`roomLocalpart`, `archivedAt`), `loadGroupListenerSettings`, `loadTopicIsGeneral`, `loadEncryptedVirtualKey`, all via the existing `runSql` with explicit row types.
- `gateway/live.ts`: `loadOwnerId`/`loadRoomJid`/`loadTopicRoomJid` now call the db.ts helpers; same nulls, same `roomJidFor` mapping. Removed `drizzle-orm`/`db/schema` imports.
- `gateway/listener.ts`: `fireRoomListener` reads group listener settings + topic isGeneral via helpers; same early-return control flow. Removed `drizzle-orm`/`db/schema` imports.
- `gateway/dm-turn.ts`: virtual-key read via `loadEncryptedVirtualKey`; the `AI ${id} has no virtual key` throw stays in dm-turn.ts. Decrypted key stays in-memory only, never logged.
- `listener/score.ts`: `loadRoster` rewritten with local `runSql` (sqlRuntimeFor) + `sql<RosterRow>` joins on `topic_ais`/`group_ais`; same mapping and sort. No import from gateway.
- Verified: none of the four files imports `drizzle-orm` or `db/schema` (grep: no output). No test files touched.

Checks:
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/gateway agents/listener agents/integration agents/reply actions/gateway`: 5 passed files, 1 skipped file; 276 passed tests, 1 skipped. Duration ~207s.
- `pnpm gate`: GATE PASS. PASS install (frozen), format, lint, typecheck, tests @zilar/server; scope: every changed file is inside the Allowed files. (First gate run failed on format in listener.ts/live.ts; fixed with prettier --write on the touched files, then re-ran gate to PASS.)

Security checklist: reads only (SELECT … LIMIT 1 / joins by id); virtual key decrypted in memory, never logged; no new routes; no caps/uniqueness changes; no audit changes.

Files changed: `apps/server/src/agents/gateway/db.ts`, `live.ts`, `listener.ts`, `dm-turn.ts`, `apps/server/src/agents/listener/score.ts`, task file.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (09:19) is newer than HEAD 7c5a8ed7.
- **No test file changed.**
- **Lead check:**
  - the 6 new helpers in `gateway/db.ts` and the two roster joins in `score.ts` are the same selects as the drizzle versions (`LIMIT 1` where it was);
  - grep finds no `drizzle-orm` or `db/schema` import in `live.ts`, `listener.ts`, `dm-turn.ts` or `score.ts`.

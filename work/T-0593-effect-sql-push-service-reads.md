---
id: T-0593
title: "effect/sql: the four drizzle reads in push/service.ts (room topic by localpart, its group, own and General mute rows) move to effect/sql; rows keep their drizzle shapes; same skip/visibility/mute decisions; tests unchanged"
status: todo
milestone: M5
branch: task/T-0593-effect-sql-push-service-reads
model: auto
effort: low
depends_on: [T-0584]
estimate: 0.5 day
---

# T-0593: the push service reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. `apps/server/src/push/service.ts` (540 lines) has four drizzle selects, all on `deps.db` with no transaction.

### Verified facts (do not re-derive)
- **Imports:** `and`, `eq` (line 2); `chatPrefs`, `groups`, `topics` (5).
- **`resolveRoomCandidate` (around 401-445):**
  - (409) `SELECT * FROM topics WHERE room_localpart = $1` (no `LIMIT`; the first row is used). A missing topic gives `{ status: 'skip' }`;
  - the full row goes to `canSeeTopic(deps.db, topic: TopicRow, userId)` (`topics/access.ts:116`);
  - (419) `SELECT * FROM groups WHERE id = $1`; a missing group gives skip. `group.roomLocalpart` and `group.title` are used;
  - **keep `LIMIT`-free semantics or add `LIMIT 1`**: `room_localpart` is unique, so both are the same. Say which you chose.
- **`isMuted` (around 484-510):**
  - (491-494) `SELECT muted_until FROM chat_prefs WHERE user_id AND chat_jid LIMIT 1`;
  - (500-503) the same with the General room's jid;
  - `muted_until` is timestamptz (`db/schema.ts:724`), compared with `.getTime()`, so it must stay a `Date` or `null`.
- **Row shapes.** Effect/sql maps snake_case to camelCase (`transformResultNames: snakeToCamel`, `apps/server/src/effect/sql.ts`). Type the results as `TopicRow` and `typeof groups.$inferSelect` (type-only imports); check that `groups` has no bigint or numeric column (`db/schema.ts`, the `groups` table).
- **The sql runtime:** a local `runSql(db, effect) = sqlRuntimeFor(db).runPromise(effect)`, as in `apps/server/src/agents/gateway/db.ts`. Every push test uses `createTestContext`, which registers the runtime.
- **When done:** `push/service.ts` has no value import from `drizzle-orm` or `db/schema`.
- **Tests (all unchanged):** `apps/server/src/push/*.test.ts`.

### What to build
1. Move the four reads to effect/sql with the same skip, visibility and mute decisions.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/push/service.ts` (lines 395-515), `apps/server/src/agents/gateway/db.ts` and `apps/server/src/effect/sql.ts`.

### Allowed files
`apps/server/src/push/service.ts`, `work/T-0593-effect-sql-push-service-reads.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push
pnpm gate
```

### Acceptance
- `push/service.ts` reads through effect/sql with the same decisions.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

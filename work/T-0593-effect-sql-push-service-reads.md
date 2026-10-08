---
id: T-0593
title: "effect/sql: the four drizzle reads in push/service.ts (room topic by localpart, its group, own and General mute rows) move to effect/sql; rows keep their drizzle shapes; same skip/visibility/mute decisions; tests unchanged"
status: merged
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

### What I did

Moved the four `drizzle` reads in `apps/server/src/push/service.ts` onto
`effect/sql`, with the same skip / visibility / mute decisions:

1. **`resolveRoomCandidate` topic read** (was `deps.db.select().from(topics).where(eq(topics.roomLocalpart, localpart))`):
   ``sql<TopicRow>`SELECT * FROM topics WHERE room_localpart = ${localpart} LIMIT 1` ``.
   The row is typed `TopicRow` (type-only import from `../topics/access`) and
   passed unchanged to `canSeeTopic(deps.db, topic, userId)`.
2. **`resolveRoomCandidate` group read** (was `eq(groups.id, topic.groupId)`):
   ``sql<typeof groups.$inferSelect>`SELECT * FROM groups WHERE id = ${topic.groupId} LIMIT 1` ``.
   `groups` is now a type-only import from `../db/schema`; `group.roomLocalpart`
   and `group.title` are used as before.
3. **`isMuted` own-pref read**: ``sql<{ mutedUntil: Date | null }>`SELECT muted_until FROM chat_prefs WHERE user_id = ${userId} AND chat_jid = ${chatJid} LIMIT 1` ``.
4. **`isMuted` General-pref read**: the same query with `generalJid`.

Added a local helper next to the existing `awaitDb`:

```ts
function runSql<A>(
  db: ServerDatabase,
  effect: Effect.Effect<A, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}
```

**`LIMIT` choice:** I added `LIMIT 1` to all four queries. `topics.room_localpart`
is unique, so this is identical to the old `LIMIT`-free "first row" behavior,
and it matches the other converted services (`blocks/service.ts`,
`contact-requests/service.ts`).

**Row shapes:** `effect/sql` camelCases via `transformResultNames: snakeToCamel`,
so `SELECT *` yields the exact drizzle `TopicRow` / `typeof groups.$inferSelect`
shapes. `muted_until` is `timestamptz` and comes back as `Date | null`, so the
`.getTime()` comparisons are unchanged. I checked the `groups` table: it has no
`bigint` or `numeric` column (all `text`/`boolean`/`integer`/`timestamp`).

**Imports:** the value import `{ and, eq } from 'drizzle-orm'` and
`{ chatPrefs, groups, topics } from '../db/schema'` are gone. `push/service.ts`
now has no value import from `drizzle-orm` or `db/schema`; `groups` is
type-only and `TopicRow` comes from `../topics/access`. `canSeeTopic` and the
`./store` reads are untouched and still run on drizzle — both clients sit on
the same database.

### Files changed
- `apps/server/src/push/service.ts`
- `work/T-0593-effect-sql-push-service-reads.md`

No test file was touched: all tests are unchanged.

### Commands run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot push` →
  10 passed, 1 skipped test files; 69 passed, 1 skipped tests (199.79s).
- `pnpm gate` →
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (12.1s)
  PASS  format  (145.4s)
  PASS  lint  (3.2s)
  PASS  typecheck  (89.5s)
  PASS  tests @zilar/server  (86.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

None. No `LIMIT`-free variant kept; see above for the `LIMIT 1` decision.

### Open questions

None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean. The packet (12:21) is newer than HEAD 4e87dae4.
- **No test file changed.**
- **Lead check:**
  - the four reads (topic by localpart, group, own mute, General mute) run on effect/sql, typed as `TopicRow` and the groups row;
  - only a type import of `db/schema` is left.

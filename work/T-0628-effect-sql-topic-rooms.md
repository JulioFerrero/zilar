---
id: T-0628
title: "effect/sql: topics/rooms.ts reads (desiredMembers, the AI member and channel-voice reads, visibleRoomLocalparts, the room-option reconcile) off drizzle; same affiliations, same logs; tests unchanged"
status: merged
milestone: M5
branch: task/T-0628-effect-sql-topic-rooms
model: auto
effort: low
depends_on: [T-0596]
estimate: 0.5 day
---

# T-0628: topic room reads on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: `effect/sql` replaces drizzle everywhere. This is F10 in `docs/audit/effect-last-mile.md` §2 (T-0626). The recipe is `docs/audit/effect-sql-migration.md` §(a), with the pins example in `apps/server/src/pins/service.ts` (lines 150-230, a private `runSql`).

### Verified facts (do not re-derive; read the whole file, 478 lines)
- **`apps/server/src/topics/rooms.ts`** has only reads. The drizzle imports are at 1 and 3. The reads:
  - `desiredMembers` (32-106):
    - the group `kind` (39-43);
    - the group members' `user_id, role` (45-48 and 71-74);
    - the `topic_members` user ids (76-79);
  - `addTopicAiMembers` (116-151):
    - `ais.jid, ais.status` joined from `group_ais` by `group_id` (125-129);
    - `ais.id, ais.jid` joined from `topic_ais` by `topic_id` (141-145);
  - `applyChannelAiVoice` (159-184): `ais.jid, owner, status` joined from `group_ais` (164-168), and the group members (172-175);
  - `visibleRoomLocalparts` (424-427): the user's `group_members.group_id` rows;
  - `reconcileRoomSubscriptionOptions` (451): every `topics.room_localpart`.
- **No caller passes a transaction.** `syncTopicRoom` is called with the top-level db at:
  - `apps/server/src/groups/service.ts:1016` (after the commit) and `:1336`;
  - `apps/server/src/invite-links/service.ts:629`.

  `reconcileRoomSubscriptionOptions` is called at `apps/server/src/index.ts:330`, and `syncPushSubscriptionsForUser` at `apps/server/src/push/api.ts:329`.
- **Leave alone:** the calls to `topicRoleHolderIds`, `allowedTopicAiIds`, `visibleTopics` and `userIdsWithDevices` are other modules' functions. Keep each signature; `TopicRoomDeps.db` stays `ServerDatabase`.
- **No bigint column** is read here.
- **Tests that must pass unchanged:**
  - `apps/server/src/topics/*.test.ts`;
  - `apps/server/src/groups/*.test.ts`;
  - `apps/server/src/invite-links/*.test.ts`;
  - `apps/server/src/push/*.test.ts`.

### What to build
1. Move every read listed above to effect/sql, with the same filters and the same row order where the code depends on it (it builds Maps, so it does not). The file keeps no value import from `drizzle-orm` or `db/schema`.
2. **Tests:** every listed test passes **unchanged**.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md` (the effect/sql section), `apps/server/src/pins/service.ts` (lines 150-230), `apps/server/src/topics/rooms.ts`.

### Allowed files
`apps/server/src/topics/rooms.ts`, `work/T-0628-effect-sql-topic-rooms.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics src/groups src/invite-links src/push
pnpm gate
```

### Acceptance
- The room reads run on effect/sql with the same affiliations.
- Every listed test is unchanged and green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Moved every read in `apps/server/src/topics/rooms.ts` off drizzle onto `effect/sql`, with the same filters and row shapes:

- Added a private `runSql(db, effect)` (`sqlRuntimeFor(db).runPromise(...)`, same shape as `pins/service.ts`).
- Added a small `readGroupMembers(db, groupId)` helper (the query the code ran three times, unchanged: `SELECT user_id, role FROM group_members WHERE group_id = $1`).
- Converted:
  - `desiredMembers`: the group `kind` (`SELECT kind FROM "groups" WHERE id = $1 LIMIT 1`), the group members, and the private `topic_members` user ids.
  - `addTopicAiMembers`: the General `group_ais JOIN ais` read (`jid, status`) and the `topic_ais JOIN ais` read (`id, jid`).
  - `applyChannelAiVoice`: the `group_ais JOIN ais` read (`jid, owner, status`) and the group members.
  - `visibleRoomLocalparts`: the user's `group_members.group_id` rows.
  - `reconcileRoomSubscriptionOptions`: every `topics.room_localpart` (`SELECT room_localpart FROM topics`).
- Removed the `drizzle-orm` and `db/schema` value imports. The file imports `Effect`, `SqlClient`, `SqlError`, `sqlRuntimeFor`. No exported signature changed; `TopicRoomDeps.db` stays `ServerDatabase`; the calls to `topicRoleHolderIds`, `allowedTopicAiIds`, `visibleTopics` and `userIdsWithDevices` are untouched.
- Rows are typed inline with the camelCase names `transformResultNames` produces (`user_id` → `userId`, etc.). `"groups"` is quoted because `GROUPS` is a Postgres keyword.
- No test file was changed.

### Files changed

- `apps/server/src/topics/rooms.ts`
- `work/T-0628-effect-sql-topic-rooms.md`

### Commands and real results

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/topics src/groups src/invite-links src/push` → `Test Files 15 passed | 1 skipped (16)`, `Tests 203 passed | 1 skipped (204)`.
- `pnpm gate` (final run) →
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (12.8s)
  PASS  lint  (0.5s)
  PASS  typecheck  (6.4s)
  PASS  tests @zilar/server  (10.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  The first gate run failed on `format` (prettier), then on `typecheck` (a `readonly` array return type); both fixed inside `rooms.ts` only. All listed tests are unchanged.

### Problems / deviations

- No deviations from the spec. The two files touched are exactly the Allowed files.

### Open questions

- None.

## Review (written by Claude)

**2026-10-08, lead:** approved.
- **Pre-review:** clean, no findings. The packet head is d61865bb, the current HEAD.
- **Lead check of the SQL:** the eight reads keep their filters and joins, and every value is a bound parameter. No drizzle import is left.

---
id: T-0628
title: "effect/sql: topics/rooms.ts reads (desiredMembers, the AI member and channel-voice reads, visibleRoomLocalparts, the room-option reconcile) off drizzle; same affiliations, same logs; tests unchanged"
status: todo
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

## Review (written by Claude)

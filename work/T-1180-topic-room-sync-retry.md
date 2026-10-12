---
id: T-1180
title: "SG-3: a topic-room affiliation sync that fails after a group membership change (ejabberd unreachable) is retried every 60 s until it succeeds, so a removed member cannot keep reading other topic rooms and an added member gets them"
status: merged
milestone: M5
branch: task/T-1180-topic-room-sync-retry
model: auto
effort: default
depends_on: []
estimate: 0.3 day
---

# T-1180: Retry failed topic-room syncs

## Spec (written by Claude, do not edit)

### Why
`docs/audit/social-graph-audit.md` SG-3 (P1, suspected).
- **What happens on a removal:** `removeGroupMember` sets `none` on the General room inside the transaction (`apps/server/src/groups/members.ts:154-164`). The other topic rooms are synced afterwards by `syncGroupTopicRooms` (`apps/server/src/groups/ais.ts:278-296`), which **swallows every failure** with a warn log (`:290-294`).
- **The result:** if ejabberd is unreachable for that call, the removed person keeps `member` on every other topic room (members-only, MAM on) and can keep reading and posting until the next membership change. Adding members has the same shape (`members.ts:105`): the new member doesn't get the topic rooms.
- **The callers:** `ais.ts:252`, `members.ts:105` and `members.ts:225`.
- **The retry is safe:** `syncTopicRoom` is idempotent (`apps/server/src/topics/room-sync.ts:21-88`).
- **Sizes:** `ais.ts` is 367 lines and `members.ts` 393, so new code goes in a new file.

### What to build
1. **A new `apps/server/src/groups/room-sync-retry.ts`:**
   - `notePendingGroupSync(groupId, deps)`, where `deps` is `{ db, adminClient, domain, logger }`;
   - an in-memory map of pending group ids to the latest deps;
   - one `setInterval` every 60 s, created lazily on the first entry and `unref()`'d, so it never holds the process open;
   - each tick re-runs `syncGroupTopicRooms`' per-topic sync for every pending group, and removes a group only when **every** topic synced without error.
   - Export `drainPendingGroupSyncs()` for the test, and `stopRoomSyncRetry()` to clear the interval on shutdown. If wiring shutdown needs `main.ts` (over 400 lines), skip it: `unref` is enough. Say so in the Report.
2. **`ais.ts` `syncGroupTopicRooms`:** track whether any topic failed, and if so call `notePendingGroupSync(groupId, …)` once after the loop. The function's signature and its warn log stay the same.
3. **Test** (permissions), 1, in a new `apps/server/src/groups/room-sync-retry.test.ts`. Use an admin client fake whose affiliation call throws on the first run and succeeds after:
   1. `syncGroupTopicRooms` notes the group;
   2. `drainPendingGroupSyncs()` syncs it and clears it.
   Use `createTestContext` (`apps/server/src/test-support.ts`) if a database is needed.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md` (SG-3), `apps/server/src/groups/ais.ts:240-300`, `apps/server/src/groups/members.ts:90-230`, `apps/server/src/topics/room-sync.ts` and `apps/server/src/test-support.ts`.

### Allowed files
`apps/server/src/groups/room-sync-retry.ts`, `apps/server/src/groups/room-sync-retry.test.ts`, `apps/server/src/groups/ais.ts`, `work/T-1180-topic-room-sync-retry.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/room-sync-retry.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.

---

## Report (written by the worker when done)

### What I did
- Added `apps/server/src/groups/room-sync-retry.ts`:
  - `notePendingGroupSync(groupId, deps)` stores the group id → latest `TopicRoomDeps` in a module-level `Map` and, on the first entry, creates a 60 s `setInterval` that calls `drainPendingGroupSyncs()`; the timer is `unref()`'d so it never holds the process open.
  - `drainPendingGroupSyncs()` runs one pass over every pending group: it re-reads the group's active (`archived_at IS NULL`) topics and re-runs `syncTopicRoom` for each. A group is deleted from the map only when every topic synced without error. Exported for the test.
  - `stopRoomSyncRetry()` clears the interval.
  - A failed topic read or topic sync is logged with the group id only (never a topic name) and keeps the group pending.
- `apps/server/src/groups/ais.ts`: `syncGroupTopicRooms` now tracks `failed` and, after the loop, calls `notePendingGroupSync(groupId, { db, adminClient, domain, logger })` once when any topic failed. The signature, the per-topic warn log and its message are unchanged (only added the `failed = true;` line).
- Added `apps/server/src/groups/room-sync-retry.test.ts`: a `FakeAdminClient` subclass whose `setAffiliation` rejects on the first call and succeeds after; seeds a group with its General topic, proves the first `syncGroupTopicRooms` applies no affiliation and notes the group, then `drainPendingGroupSyncs()` applies the affiliation and forgets the group (a later drain no longer touches a room that drifted).

### Files changed
- `apps/server/src/groups/room-sync-retry.ts` (new, 81 lines)
- `apps/server/src/groups/room-sync-retry.test.ts` (new, 67 lines)
- `apps/server/src/groups/ais.ts` (376 lines, was 367)
- `work/T-1180-topic-room-sync-retry.md`

Every touched file is at most 400 lines.

### Commands and real results
- `pnpm install`: done in 14.5s (peer-dependency warning on `@types/react-dom` only, pre-existing).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/room-sync-retry.test.ts`: `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- `pnpm gate` (repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (1.7s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.6s)
  PASS  effect  (1.8s)
  PASS  tests @zilar/server  (13.7s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- Shutdown wiring skipped, as the spec allows: `apps/server/src/main.ts` is 723 lines and is not in the Allowed files, so `stopRoomSyncRetry` is exported but not called on shutdown. `unref` is enough for the process not to wait on the timer.
- The retry module re-reads the group's topics itself (a small `SELECT * FROM topics WHERE group_id = ... AND archived_at IS NULL`) instead of reusing `groupTopicRows`, which is private to `ais.ts`. `syncGroupTopicRooms` returns `void` by spec, so the drain cannot use it to learn success.
- The map is in-memory (as specified); a restart drops pending retries and the next membership change of the group notes it again.

### Security checklist
- No secrets or tokens are logged; the new logs carry the group id only, never a topic or room name.
- No new route, no writes, no SQL that changes state; the retry only re-applies affiliations through the existing idempotent `syncTopicRoom`.
- Nothing here runs before the caller's permission checks: it only runs after a membership change already committed.

No open questions.


## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean.**
- **`room-sync-retry.ts`:**
  - a pending map from group id to deps;
  - a lazy 60 s interval, `unref`'d;
  - each drain re-syncs every non-archived topic, and clears a group only when all succeed;
  - `stopRoomSyncRetry()` is exported.
- **`syncGroupTopicRooms`** notes the group once when any topic fails. Its signature and log are unchanged.
- **Test:** fail, then drain and sync, then clear. 1 of 1 in the branch, run by the lead.

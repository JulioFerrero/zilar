---
id: T-2010
title: "Room rights follow-ups to T-2002: group creation and ownership hand-over write affiliations through roomAffiliationFor (no MUC owner for people), and the room-sync retry includes archived topics"
status: merged
milestone: M5
branch: task/T-2010-room-rights-followups
model: deepseek/deepseek-flash
effort: default
estimate: 25 min
---

# T-2010: Room rights follow-ups

## Spec (written by Claude, do not edit)

### Why
T-2002 (merged 2026-10-18) made every person a plain MUC `member`, except a channel feed's owner and admins, who hold `admin` there for voice. Its pre-review found three places that still write the old affiliations. Until the next sync, a new group's creator holds MUC `owner`.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **The shared rule.** `topics/room-members.ts` exports `roomAffiliationFor(role, isChannelFeed)` (T-2002). It returns `'admin'` for a channel feed's owner or admin, otherwise `'member'`.
- **Group creation.** `groups/service.ts` (298 lines), in the creation path around `:236-250`, calls `adminClient.setAffiliation(roomLocalpart, jidFor(localpartFor(input.creatorId), input.domain), 'owner')`. For a channel (the T-0124 comment) it also sets admin or owner voice.
- **Ownership hand-over.** `groups/ownership.ts` (146 lines), after the hand-over (`:85-100`), writes `[{ userId: target, role: 'owner' }, { userId: actor, role: 'admin' }]` as room affiliations, then calls `syncChannelVoice` and `syncGroupTopicRooms`. Those correct the rooms, but a failed sync leaves `owner` behind.
- **Sync retry.** `groups/room-sync-retry.ts` (81 lines) re-reads topics with `WHERE group_id = ${groupId} AND archived_at IS NULL` (`:76-77`), so a failed sync of an archived topic room is never retried.
- **Tests.** `groups/ownership.test.ts`, `groups/member-roles.test.ts` and `groups/room-sync-retry.test.ts` exist.

### Steps
1. **Group creation.** Set the creator's affiliation with `roomAffiliationFor('owner', isChannel)`: `admin` for a channel, `member` for a group.
2. **Ownership hand-over.** Compute both affiliations with `roomAffiliationFor(role, isChannelFeed)` for the group's General room. A plain group then writes `member` for both people, and a channel writes `admin` for both. Keep the sync calls.
3. **Sync retry.** Include archived topics in the retry query, the same way T-2002's removal sync does.
4. **Tests:**
   - creating a plain group sets the creator to `member` on its room, with the fake admin client;
   - a hand-over in a plain group sets no `owner` affiliation.

   Add each to the nearest test file.
5. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/groups/service.ts`
- `apps/server/src/groups/ownership.ts`
- `apps/server/src/groups/room-sync-retry.ts`
- `apps/server/src/groups/ownership.test.ts`
- `apps/server/src/groups/room-sync-retry.test.ts`
- `apps/server/src/groups/member-roles.test.ts`
- `work/T-2010-room-rights-followups.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

- **Group creation** (`groups/service.ts`): the creator's affiliation now comes from
  `roomAffiliationFor('owner', kind === 'channel')` — `member` for a plain group,
  `admin` (channel feed voice) for a channel — instead of the hardcoded `owner`.
- **Ownership hand-over** (`groups/ownership.ts`): both General-room affiliations are
  computed with `roomAffiliationFor` (target as `owner`, actor as `admin`), so a plain
  group writes `member` for both people and a channel writes `admin` for both. The
  `syncChannelVoice` and `syncGroupTopicRooms` calls and the best-effort error logging
  are unchanged.
- **Sync retry** (`groups/room-sync-retry.ts`): the retry query no longer filters
  `archived_at IS NULL`, so a failed sync of an archived topic room is retried like
  T-2002's removal sync. Comments updated to say "every topic room".
- **Tests**:
  - `groups/member-roles.test.ts`: creating a plain group sets its creator to `member`
    on the created room (fake admin client).
  - `groups/ownership.test.ts`: a hand-over in a plain group leaves both people as
    `member` and no `owner` affiliation on the room.
  - `groups/room-sync-retry.test.ts`: a failed sync of an archived topic room is
    retried by `drainPendingGroupSyncs` and lands the owner as `member`.

Files changed (all inside Allowed files):

- `apps/server/src/groups/service.ts`
- `apps/server/src/groups/ownership.ts`
- `apps/server/src/groups/room-sync-retry.ts`
- `apps/server/src/groups/member-roles.test.ts`
- `apps/server/src/groups/ownership.test.ts`
- `apps/server/src/groups/room-sync-retry.test.ts`
- `work/T-2010-room-rights-followups.md`

### Checks run

- `pnpm install`: done (1155 packages, 20.4s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/member-roles.test.ts`:
  1 file passed, 7 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/ownership.test.ts`:
  1 file passed, 6 tests passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/room-sync-retry.test.ts`:
  1 file passed, 3 tests passed.
- `pnpm gate` from the repo root:

```text
gate: 7 changed file(s) against main
PASS  install (frozen)  (3.1s)
PASS  format  (0.9s)
PASS  lint  (1.3s)
PASS  typecheck  (7.6s)
PASS  effect  (2.7s)
PASS  tests @zilar/server  (23.6s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- No deviations from the spec. No new dependencies.
- A channel's creator now holds `admin` rather than `owner`; that still carries voice
  in the feed and matches `roomAffiliationFor`. A channel hand-over also writes `admin`
  for both people, as specified.
- The new retry test sets `FakeAdminClient.failAffiliation = true` for the first sync
  and clears it before the drain, so it deterministically checks the archived room's
  retry (it fails if archived topics are left out of the query).


## Review (written by Claude)

Approved. The pre-review was clean, with one nit: a stale comment.

Group creation and the ownership hand-over now both use `roomAffiliationFor`. The retry now re-syncs archived topic rooms as well. That closes the last places that gave people MUC `owner`.

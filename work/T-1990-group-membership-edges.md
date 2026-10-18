---
id: T-1990
title: "Permissions: a removed member's AIs leave the group with them; ownership hand-over can't race a removal or role change into a group with no owner; General's manager rights follow the current owner/admins, not its creator — with tests"
status: merged
milestone: M5
branch: task/T-1990-group-membership-edges
model: deepseek/deepseek-flash
effort: default
estimate: 45 min
---

# T-1990: Group membership edges

## Spec (written by Claude, do not edit)

### Why
The lead's private security review on 2026-10-18 (T-1985) found three gaps in group permissions. This area is crucial, so tests are required.
1. **Removed AIs.** When a member is removed (and banned) or leaves, their AIs stay in the group. Those AIs keep answering in General with the removed person's persona and model.
2. **Ownerless group.** The hand-over takes the `group-owner:<id>` lock, but removing a member and changing a role read the roles outside any lock. Racing them can leave the group with no owner.
3. **Stale General rights.** General's `created_by` is the group's creator. After the creator hands the group over and is demoted, they still manage General: rename, pins and AI memory.

### Facts (read by the lead on 2026-10-18; paths under `apps/server/src/`)
- **Removing a member: `groups/members.ts` (281 lines).**
  - `removeGroupMember` reads the actor's and target's roles outside a transaction (`:160-177`).
  - Its transaction (`:200-221`) deletes the `group_members` row, bans the person (not on a self-leave), and deletes their `topic_members` rows. It never touches `group_ais`.
- **Removing an AI: `groups/ais.ts` (309 lines).** `removeGroupAi(db, adminClient, input)` (`:182-…`) is "allowed for the AI's owner, or a group owner or admin. The AI owner need not still be a group member". It removes the AI's group and topic rows, rules, tools, routines and memory.
- **Room sync for General: `topics/room-members.ts` (210 lines).** At `:137-151`, the General room adds every `group_ais` AI whose status is `active`, with no check that its owner is still in the group. Other topics go through `allowedTopicAiIds` (`topics/ai-access.ts:56`), which requires that.
- **Gateway rooms: `agents/gateway/db.ts` (377 lines).** At `:160-180`, "General rooms ride on the `group_ais` rows themselves", with no owner check.
- **Hand-over: `groups/ownership.ts` (146 lines).** `transferGroupOwner` takes `pg_advisory_xact_lock(hashtext('group-owner:' + groupId))` and re-reads both roles inside its transaction (`:44-72`).
- **Role change: `groups/member-roles.ts` (171 lines).** `changeMemberRole` checks the actor and target roles outside the transaction (`:35-51`), then runs `UPDATE group_members SET role = ...` by user id only (`:63-71`).
- **Topic managers: `topics/access.ts` (261 lines).**
  - `canManageTopic` returns `true` when `topic.createdBy === userId` (`:196-198`).
  - `requireManagedTopic` does the same (`:209-211`).
  - `pins/access.ts:97-99` has its own `chat.topic.createdBy === userId` shortcut.
  - `agents/memory/api.ts:119` uses `canManageTopic`.
- **Tests** already exist in `groups/ais.test.ts`, `groups/ownership.test.ts`, `groups/member-roles.test.ts` and `topics/patch.test.ts`.

### Steps
1. **Removed members take their AIs out.**
   - After a member removal or self-leave succeeds in `removeGroupMember`, remove each AI owned by that person from the group through `removeGroupAi`, with the AI owner as the actor. This cleans up the same rules, tools, routines and memory. A failure to remove one AI is logged and doesn't fail the removal.
   - **Also as defence:** in `topics/room-members.ts` (the General branch) and in `agents/gateway/db.ts` (General rooms), only count an AI whose owner is still a member of the group, the same rule `allowedTopicAiIds` applies.
2. **No ownerless group.**
   - In `removeGroupMember` and `changeMemberRole`, take the same `group-owner:<groupId>` advisory lock inside the write transaction.
   - Re-read the actor's and target's roles there, and repeat the checks: the owner can't be removed or demoted, and only the owner changes roles.
   - Add `AND role <> 'owner'` to the `DELETE` and the `UPDATE`.
3. **General follows the current managers.**
   - In `canManageTopic`, `requireManagedTopic` and the `pins/access.ts:97-99` shortcut, ignore `createdBy` when `topic.isGeneral` is true.
   - For General, only a current group owner or admin manages it.
4. **Tests (permissions are crucial).** Use the nearest existing files:
   - removing a member removes their group AI, and that AI is not in General's wanted room members;
   - a role change and a removal both refuse to touch the current owner;
   - a demoted creator of the group can't rename or pin in General.
5. **Keep every file at or under 400 lines.**

### Allowed files
- `apps/server/src/groups/members.ts`
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/ais.ts`
- `apps/server/src/topics/room-members.ts`
- `apps/server/src/topics/access.ts`
- `apps/server/src/agents/gateway/db.ts`
- `apps/server/src/pins/access.ts`
- `apps/server/src/groups/ais.test.ts`
- `apps/server/src/groups/ownership.test.ts`
- `apps/server/src/groups/member-roles.test.ts`
- `apps/server/src/topics/patch.test.ts`
- `work/T-1990-group-membership-edges.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups src/topics src/pins --reporter=dot
pnpm gate
```

### Acceptance
- The tests above pass, and the gate passes.

---

## Report (written by the worker when done)

### What I did

1. **Removed members take their AIs out.** After a successful removal (ban or
   self-leave) in `removeGroupMember`, the group's `group_ais` rows whose AI is
   owned by the departing person are removed through `removeGroupAi` with the AI
   owner as actor (it already allows the owner after they left the group), so
   the AI's topic rows, rules, tools, routines and memory are cleared too. Each
   AI is best effort: a failure is logged with ids only and never fails the
   removal. As defence in depth, the General branch of
   `topics/room-members.ts` (`addTopicAiMembers`) and the General rooms in
   `agents/gateway/db.ts` (`listAiRooms`) now join `group_members` on the AI's
   owner, so an AI whose owner is not a group member is never counted even if a
   cleanup write failed.
2. **No ownerless group.** `removeGroupMember` and `changeMemberRole` now take
   `pg_advisory_xact_lock(hashtext('group-owner:<groupId>'))` inside their write
   transaction (the same lock the hand-over uses) and re-read the actor's and
   target's roles there. The checks are repeated against those locked reads: the
   owner cannot be removed or demoted and only the owner changes roles (same
   statuses/codes as before: 403 / 404). The `DELETE` and the `UPDATE` also
   carry `AND role <> 'owner'` as the same refusal at the write. The audit row
   for a role change now uses the role read inside the lock.
3. **General follows the current managers.** `canManageTopic`,
   `requireManagedTopic` and the `pins/access.ts` creator shortcut only let
   `createdBy` manage a topic when `topic.isGeneral` is false. For General the
   caller must be a current group owner/admin (membership is still read after
   `canSeeTopic`).
4. **Tests** (near the code they cover):
   - `groups/ais.test.ts`: removing a member deletes their group AI and the AI
     is not in General's wanted room members; an AI whose owner is still a
     member stays.
   - `groups/member-roles.test.ts`: the owner cannot change their own role (403)
     and stays owner.
   - `groups/ownership.test.ts`: after a hand-over, the old admin cannot remove
     the new owner (403) and the owner row is untouched.
   - `topics/patch.test.ts`: a demoted creator of the group cannot rename
     General, cannot `requireManagedTopic` it and cannot pin in it (403), while
     the current owner can.

Every changed file is within the 400-line limit (largest: `gateway/db.ts`, 382
lines). No dependencies, routes, migrations or files outside Allowed files.

### Checks run

- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/ais.test.ts src/groups/member-roles.test.ts src/groups/ownership.test.ts src/topics/patch.test.ts`:
  4 files passed, 16 tests passed.
- `pnpm --filter @zilar/server exec vitest run src/groups src/topics src/pins --maxWorkers=2 --reporter=dot`
  (the task's Checks command, with the worker cap AGENTS.md requires): 15 files
  passed, 79 tests passed.
- `pnpm gate` (from the repo root), first run: `FAIL format` on
  `member-roles.test.ts` and `patch.test.ts`; fixed with
  `pnpm exec prettier --write` on those two files, then re-ran.
- `pnpm gate` (second run):
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (2.9s)
  PASS  format  (2.4s)
  PASS  lint  (1.7s)
  PASS  typecheck  (6.9s)
  PASS  effect  (1.9s)
  PASS  tests @zilar/server  (282.5s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```

### Notes for the lead

- The AIs are removed after the membership transaction commits, so a failure
  there leaves the room sync's owner-membership check (step 1's defence) to keep
  them out of General until the next cleanup; the `group_ais` row would remain.
  This matches the spec's "a failure to remove one AI is logged and doesn't fail
  the removal".
- `assertChannelKeepsAnAdmin` still runs before the transaction (it reads the
  database through its own query and is not part of this task); the owner checks
  themselves are now inside the lock.

## Review (written by Claude)

Approved. The pre-review is clean, with two nits.
- **AI clean-up.** A removed or departing member's AIs leave the group through `removeGroupAi`. The General room and the gateway count only AIs whose owner is still a member.
- **Ownership lock.** Removal and role change now take the `group-owner:<id>` lock, re-read both roles inside it, and guard their writes with `role <> 'owner'`.
- **General.** General ignores `created_by` for manager rights.
- **Nits.** A redundant audit row is written when a role change races into a no-op, and the defence joins have no direct test. Both are harmless and left as they are.

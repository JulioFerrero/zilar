---
id: T-1187
title: "SG-4 (part 1): PUT /api/groups/:id/owner — the owner hands the group to another member (roles swap in one transaction, room affiliations follow, the old owner becomes admin and can then leave); delete-group is a later task"
status: merged
milestone: M5
branch: task/T-1187-group-owner-transfer
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1187: Hand a group over

## Spec (written by Claude, do not edit)

### Why
`docs/audit/social-graph-audit.md` SG-4 (P1, confirmed): the owner is stuck.
- **What blocks the owner:**
  - `removeGroupMember` refuses an owner target, including the owner themselves (`apps/server/src/groups/members.ts:135-137`, "The owner cannot be removed");
  - `changeMemberRole` is channel-only and never sets `owner` (`members.ts:246-310`);
  - the groups contract has no transfer endpoint (`packages/api-contract/src/groups.ts:150-206`).
- **The fix the audit gives:** a transfer that swaps the two `group_members.role` values in one transaction, sets both room affiliations, then runs `syncChannelVoice` and `syncGroupTopicRooms`, kept in a new `groups/ownership.ts`.
- **Size:** `members.ts` is 393 lines, so no growth there.

### What to build
1. **The contract:** in `packages/api-contract/src/groups.ts`, `HttpApiEndpoint.put('transferOwner', '/groups/:id/owner', { params: GroupIdParams, payload: { userId: string }, success: GroupDetail })`, with `GroupsRoleRateLimit` (the role budget). Use the existing schemas' style, and keep the file at most 400 lines.
2. **The server, a new `apps/server/src/groups/ownership.ts`,** with `transferGroupOwner({ db, adminClient, groupId, actorId, targetUserId, domain, logger })`:
   - it answers 403 unless the actor is the **owner**; 404 unless the target is a member; and 400 when the target is the actor;
   - **in one transaction:** the target becomes `owner` and the actor becomes `admin`;
   - **after the commit:** set the General room affiliations (target `owner`, actor `admin`) the same way `members.ts` sets affiliations (find the helper and cite it), then `syncChannelVoice` for channels and `syncGroupTopicRooms`. Room failures follow the existing pattern; T-1180's retry covers topic rooms;
   - record an audit entry if member role changes are audited today (find it: `group.role_changed`, T-0124), with the same shape.
3. **Wire the handler** in `apps/server/src/groups/api.ts`, next to `changeRole`, returning the fresh detail.
4. **Tests** (permissions), at most 2, in a new `apps/server/src/groups/ownership.test.ts`:
   - a non-owner gets 403;
   - the owner transfers to a member: the roles swap, and the old owner can then remove themselves (leave) with 200.

### Read first
`AGENTS.md`, `docs/audit/social-graph-audit.md` (SG-4), `packages/api-contract/src/groups.ts`, `apps/server/src/groups/api.ts`, `apps/server/src/groups/members.ts`, `apps/server/src/groups/queries.ts:81-140`, `apps/server/src/groups/ais.ts:278-300` and `apps/server/src/test-support.ts`.

### Allowed files
`packages/api-contract/src/groups.ts`, `apps/server/src/groups/ownership.ts`, `apps/server/src/groups/ownership.test.ts`, `apps/server/src/groups/api.ts`, `work/T-1187-group-owner-transfer.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups/ownership.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.

---

## Report (written by the worker when done)

**Status:** done. SG-4 (part 1): the owner hands the group over.

### What I did
- **Contract** (`packages/api-contract/src/groups.ts`): added `transferOwner` =
  `PUT /groups/:id/owner`, params `GroupIdParams`, payload `TransferGroupOwnerPayload`
  (`{ userId: string }`, `Schema.String` min length 1, same style as `ChangeGroupRolePayload`),
  success `GroupDetail`, guarded by the existing `GroupsRoleRateLimit` budget (the role budget).
  Placed next to `changeRole`.
- **Server** (new `apps/server/src/groups/ownership.ts`):
  `transferGroupOwner({ db, adminClient, groupId, actorId, targetUserId, domain, logger, audit? })`:
  - 403 unless the actor is the owner; 404 unless the target is a member; 400 when the target is
    the actor (the group itself 404s through `requireGroup`).
  - **One transaction** swaps both `group_members.role` rows (target `owner`, actor `admin`). The
    reads and the writes run inside the transaction under a per-group advisory lock
    (`pg_advisory_xact_lock(hashtext('group-owner:' + groupId))`), so two concurrent transfers
    cannot leave the group with two owners.
  - **After the commit** the General room affiliations are set the same way `members.ts` does it:
    `adminClient.setAffiliation(group.roomLocalpart, jidFor(localpartFor(userId), domain), role)`
    (the helpers are `jidFor`/`localpartFor` in `xmpp/provisioning`), target `owner`, actor `admin`.
    A failure is logged with the group id and never thrown (existing pattern). Then
    `syncChannelVoice` (channels only; a no-op for a group room) and `syncGroupTopicRooms` run —
    T-1180's retry covers a failed topic-room sync.
  - Audit: both role changes are recorded as `group.role_changed` with the existing shape
    (`subjectId` = the user whose role changed, `detail { groupId, subjectUserId, from, to }`),
    ids and roles only. The recorder is injected by the route (like `changeMemberRole`).
- **Handler** (`apps/server/src/groups/api.ts`): wired `transferOwner` next to `changeRole`,
  returning the fresh `GroupDetail` with the listener `available` flag stamped like its siblings.
- **Tests** (new `apps/server/src/groups/ownership.test.ts`, 2): a non-owner gets 403; the owner
  transfers to a member (the response roles swap: target `owner`, old owner `admin`) and the old
  owner can then remove themselves (leave) with 200.

### Files changed
- `packages/api-contract/src/groups.ts` — 222 lines
- `apps/server/src/groups/ownership.ts` — 146 lines (new)
- `apps/server/src/groups/ownership.test.ts` — 81 lines (new)
- `apps/server/src/groups/api.ts` — 370 lines

All four stay under the 400-line cap.

### Commands and real results
- `pnpm install` → done in 12.1s (1180 packages added).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/ownership.test.ts` →
  1 file passed, **2 tests passed** (5.22s). This is the task's Checks command run with the worker
  cap AGENTS.md requires.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/authz-sweep.test.ts` →
  1 file passed, **5 tests passed** (4.64s). The sweep enumerates `app.routes`, asserts every
  `/api` endpoint answers 401 without a session, and asserts no registered endpoint is skipped —
  so the new route is covered by the 401 sweep.
- `pnpm gate` from the repo root:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.5s)
  PASS  lint  (1.4s)
  PASS  typecheck  (5.0s)
  PASS  effect  (0.9s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/server  (13.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes
- **Audit entries (two, not one).** The spec says "record an audit entry ... with the same shape".
  A transfer changes two roles, and `group.role_changed` is per-subject today, so I record two
  entries (target `member|admin → owner`, actor `owner → admin`). If you want a single entry for the
  target only, it is a one-line change.
- **403 for a stranger.** The spec says "403 unless the actor is the owner", so a non-member also
  gets 403 on an existing group, rather than the "unknown and not-visible answer the same 404" rule
  used by `changeMemberRole`/`setGroupVisibility`. I followed the spec; note that
  `addGroupMembers`/`removeGroupMember` already answer 403 to non-members too.
- **No `onExcessProperty: 'error'`** on the payload (unlike the sibling `changeRole`), to keep the
  endpoint exactly as written in the spec. Easy to add if you want the strict parse for consistency.

### Open questions
- None blocking. The three notes above are the only judgement calls.

### Security checklist
- Updates are scoped with `group_id` AND `user_id`; the state that is diffed is read inside the
  transaction; the role swap is atomic under an advisory lock. Permission checks run before any
  write. Audit rows carry ids and roles only. The route sits behind `Session` and the role budget,
  and the 401 sweep covers it.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 1 nit and 1 follow-up.**
- **`PUT /api/groups/:id/owner`** (`transferOwner`, role rate limit) answers 403 unless the actor is the owner, 404 for a non-member target and 400 for self.
- **One transaction:** the target becomes owner and the actor becomes admin.
- **After the commit:**
  - the General room affiliations are set, then `syncChannelVoice` and `syncGroupTopicRooms` run (T-1180's retry covers failures);
  - a `group.role_changed` audit entry is written.
- **Tests:** non-owner 403; transfer, then the old owner leaves with 200. 2 of 2 in the branch, run by the lead.
- **Follow-up:** a transfer racing a remove of the same member needs a shared lock or an affected-row guard (`members.ts`).
- **Also to do:** web and mobile UI for the transfer (a later task).

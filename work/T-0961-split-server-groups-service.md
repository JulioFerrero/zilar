---
id: T-0961
title: "Size split T5+T6: apps/server/src/groups/service.ts (1,583 lines) into groups/{schemas,members,ais,queries}.ts, the old path a barrel"
status: merged
milestone: M5
branch: task/T-0961-split-server-groups-service
model: auto
effort: default
depends_on: [T-0936]
estimate: 0.5 day
---

# T-0961: Split `groups/service.ts`

## Spec (written by Claude, do not edit)

### Why
Julio's limit is at most 400 lines per source file, and he chose to run every task of `docs/audit/size-plan.md`. `apps/server/src/groups/service.ts` is 1,583 lines (`wc -l`, main, 2026-10-10). It has not changed since the plan was written. The plan splits it in two tasks (T5, T6); this task does both, because they are one file.

### What to build
Follow `docs/audit/split-rules.md` exactly. The plan entry is `docs/audit/size-plan.md` §2.1 #3: `groups/schemas.ts`, `groups/members.ts`, `groups/ais.ts`, `groups/queries.ts`, under `apps/server/src/`. `groups/service.ts` becomes the barrel.

`members.ts` comes to about 450 lines in the plan's ranges. Split it once more into `members.ts` (membership and roles) and `invites.ts` (invites), following `split-rules.md` item 4.

Skip the entry's cross-file Dedup (`groups/access.ts`), which is task F5. This is permissions code (membership and roles), so move it unchanged.

### Read first
`AGENTS.md`, `docs/audit/split-rules.md`, `docs/audit/size-plan.md` §2.1 #3, and `apps/server/src/groups/service.ts`.

### Allowed files
`apps/server/src/groups/service.ts`, `apps/server/src/groups/schemas.ts`, `apps/server/src/groups/members.ts`, `apps/server/src/groups/invites.ts`, `apps/server/src/groups/ais.ts`, `apps/server/src/groups/queries.ts`, `work/T-0961-split-server-groups-service.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/groups/visibility.test.ts src/roles/roles.test.ts src/invite-links/invite-links.test.ts
pnpm gate
```

### Acceptance
The Checks pass, and the Report has everything `split-rules.md` item 8 asks for.

---

## Report (written by the worker when done)

### What I did
Split `apps/server/src/groups/service.ts` (1,583 lines on main) into six files, following `docs/audit/size-plan.md` §2.1 #3 and `docs/audit/split-rules.md`. `groups/service.ts` is now a barrel that re-exports every name it exported before, with the same names and kinds, and keeps only the code the plan left uncovered.

New files and what they hold:
- `groups/schemas.ts` — constants, view/input interfaces, `resolveGroupBackground`, and the shared `mapXmppError`.
- `groups/queries.ts` — row reads: `getGroupDetail`, `getMembership`, `listMembersForViewer`, `listGroupsForUser`, `listGroupMembers`, `listGroupAis`, `requireGroup`, `assertChannelKeepsAnAdmin`, `destroyQuietly`.
- `groups/members.ts` — `addGroupMembers`, `removeGroupMember`, `changeMemberRole`, `syncChannelVoice`.
- `groups/invites.ts` — `assertContacts`, `inviteNewMembers` (the further split split-rules item 4 asks for).
- `groups/ais.ts` — group-AI add/remove and topic-room sync.
- `groups/service.ts` (barrel) — `patchGroup`, `randomRoomLocalpart`, `createGroup`, plus the re-exports.

No behaviour change: every function body is moved verbatim (I copied the line ranges with `sed`). No new tests, no test edits, and no importer changed. The cross-file Dedup (`groups/access.ts`, task F5) was skipped as the spec says, so the permission/membership code moved unchanged.

### File sizes (`wc -l`)
- old `apps/server/src/groups/service.ts`: 1,583
- `apps/server/src/groups/service.ts` (barrel): 297
- `groups/schemas.ts`: 236
- `groups/members.ts`: 393
- `groups/invites.ts`: 55
- `groups/ais.ts`: 367
- `groups/queries.ts`: 340

Every file is at most 400 lines.

### Export diff (split-rules item 8)
`grep -E '^export'` on the old file against the barrel plus the new files.

Old public API (31 names): values `MAX_GROUP_MEMBERS`, `ROOM_LOCALPART_LENGTH`, `patchGroup`, `randomRoomLocalpart`, `createGroup`, `getGroupDetail`, `getMembership`, `addGroupMembers`, `removeGroupMember`, `changeMemberRole`, `listMembersForViewer`, `syncChannelVoice`, `addGroupAi`, `removeGroupAi`, `listGroupsForUser`; types `GroupRole`, `InviteLogger`, `GroupMemberView`, `ChannelKind`, `GroupListenerEagerness`, `GroupBackground`, `GroupDetail`, `GroupAiView`, `ChatGroup`, `CreateGroupInput`, `AddGroupMembersInput`, `RemoveGroupMemberInput`, `AddGroupAiInput`, `RemoveGroupAiInput`, `PatchGroupInput`, `ChangeMemberRoleInput`.

After: the barrel defines `patchGroup`, `randomRoomLocalpart`, `createGroup` and re-exports the other 28 names — values `MAX_GROUP_MEMBERS`, `ROOM_LOCALPART_LENGTH` from `./schemas`, the 16 type names above from `./schemas`, `getGroupDetail`, `getMembership`, `listGroupsForUser`, `listMembersForViewer` from `./queries`, `addGroupMembers`, `changeMemberRole`, `removeGroupMember`, `syncChannelVoice` from `./members`, and `addGroupAi`, `removeGroupAi` from `./ais`. The set and the kinds are identical to before.

New internal-only exports (private before, `export` added only so the moved callers can import them; the barrel does not re-export them): `ROOM_ALPHABET`, `ROOM_ROLES`, `resolveGroupBackground`, `mapXmppError` (schemas); `listGroupMembers`, `listGroupAis`, `requireGroup`, `assertChannelKeepsAnAdmin`, `destroyQuietly` (queries); `assertContacts`, `inviteNewMembers` (invites); `groupTopicRows`, `syncGroupTopicRooms`, `emitDroppedGroupTopicAis`, `archiveDrainedPrivateTopics` (ais).

### Deviations from the plan's line ranges (all inside the entry's named modules)
1. `listMembersForViewer` and `assertChannelKeepsAnAdmin` (both reads: a SELECT plus a guard) moved from the `members.ts` range into `queries.ts`, "row reads". Without this, `members.ts` would be over 400 lines.
2. `ChangeMemberRoleInput` moved to `schemas.ts` ("view + input interfaces").
3. `syncChannelVoice` moved to `members.ts` ("membership and roles") instead of staying uncovered in the barrel.
4. `mapXmppError` moved to `schemas.ts` instead of staying in the barrel. The plan leaves it in `service.ts`, but `addGroupMembers`, `removeGroupMember`, `changeMemberRole`, `addGroupAi` and `removeGroupAi` all call it, so keeping it in the barrel would make the barrel import its own modules while those modules import the barrel — a runtime import cycle. `schemas.ts` already holds the other shared helper (`resolveGroupBackground`), so it holds it now. Its body is unchanged; it stays the Dedup target of an F task (§2.8).

### Tests and gate
Ran the nearest tests (AGENTS §Tests form):
`pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test.ts src/roles/roles.test.ts src/invite-links/invite-links.test.ts`
→ 3 files passed, 68 tests passed.

`pnpm gate` from the repo root:
```
gate: 7 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.8s)
PASS  lint  (1.9s)
PASS  typecheck  (4.6s)
PASS  effect  (1.9s)
PASS  tests @zilar/server  (14.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```
The first gate run failed only the format step on `ais.ts` and `members.ts`; I ran `prettier --write` on my files and re-ran, after which it passed.

No `effect-plain` marker was needed: every new file imports `effect` (value), so none is classified `needs-effect`.

### Blocked / needs a decision
None.

### Open questions
The plan's `members.ts` range is 401 lines on its own and ~447 with the invite helpers, so it is over 400 even after the invites are split out. I applied the deviations above (rule 4) to keep every file at most 400 lines. If the lead would rather keep `mapXmppError` and `syncChannelVoice` in the barrel and accept the internal import cycle, that is a small change back.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The split:** `groups/service.ts` (1,583 lines) becomes a barrel plus `schemas`, `members`, `invites`, `ais` and `queries`, the largest `members.ts` at 393. The membership and role checks moved unchanged.
- **Check:** the 68 nearest tests pass (visibility, roles, invite links), and so does the gate.

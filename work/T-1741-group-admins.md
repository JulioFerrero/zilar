---
id: T-1741
title: "Group admins: the owner can make a group member an admin and remove admin (server changeRole allowed for plain groups, not only channels), with Make admin / Remove admin in the group member menu on web and phone"
status: merged
milestone: M5
branch: task/T-1741-group-admins
model: auto
effort: default
depends_on: []
estimate: 40 min
---

# T-1741: Admins in groups

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-16: "i cant make a person an admin, just pass the owner, we need the option to have admins".

### Facts (the lead read them on 2026-10-16)
- **Roles already exist:** `'owner' | 'admin' | 'member'` (`apps/server/src/groups/schemas.ts:19`). Group admins already have powers: `isGroupAdmin` is owner or admin (`apps/server/src/groups/access.ts:27`), and group owners or admins decide approvals (`apps/server/src/approvals/access.ts`).
- **The server refuses plain groups:**
  - the route `PUT /groups/:id/members/:userId/role` (`changeRole`, `apps/server/src/groups/api.ts:200-214`; contract `packages/api-contract/src/groups.ts:179`) calls `changeMemberRole`;
  - that function refuses non-channels with a 404 (`apps/server/src/groups/member-roles.ts:42-47`, "T-0124: channels only");
  - only the owner may change roles; the owner can't be demoted or demote themselves;
  - demoting a channel's last admin is refused (`:65`);
  - a room affiliation sync follows, and `:152` keeps the channel voice sync channel-only.
- **The clients:**
  - both have the call: web `apps/web/src/lib/api/groups.ts:172`, phone `apps/mobile/src/lib/groups-api.ts:142`;
  - channels show Make admin / Remove admin: web `apps/web/src/components/channel-info/ChannelPeople.tsx:184-194`, phone `apps/mobile/src/components/channel-info/people-page.tsx:168`;
  - the group member menus only offer Make owner and Remove: web `apps/web/src/components/group-info/MemberRow.tsx:39-110`, phone `apps/mobile/src/components/group-info/members-page.tsx:186-305` (362 lines);
  - the phone already shows an admin mark when `member.role === 'admin'` (`members-page.tsx:212`).

### Steps
1. **Server, `apps/server/src/groups/member-roles.ts`:**
   - allow plain groups (`kind` group) as well as channels: the owner sets a member to `admin` or back to `member`;
   - keep every other rule (owner only, the owner can't be demoted, the channel last-admin rule);
   - keep the room affiliation step for both kinds (`admin` for admins, `member` for members). The channel voice sync stays channel-only (`:152`);
   - the audit entry stays the same;
   - update the T-0124 comment.
2. **Web, `MemberRow.tsx`:** in the owner's ⋮ menu for another member, add **Make admin** (when member) or **Remove admin** (when admin), before Make owner. Call the existing `changeRole`, then refresh the member list the way Make owner does. Use the same menu item style as the channel menu.
3. **Phone, `members-page.tsx`:** the same two items in the owner's action sheet (`:268-275`), calling `changeRole` from `apps/mobile/src/lib/groups-api.ts:142` and refreshing the list. Keep the file under 400 lines; move the menu into a new `apps/mobile/src/components/group-info/member-menu.tsx` if needed.
4. **One server test** (permissions): the owner can make a group member admin and back; a non-owner gets 404. Add it to the existing tests of `member-roles.ts`, or to its nearest test file.
5. **No other UI changes.**

### Allowed files
- `apps/server/src/groups/member-roles.ts`
- `apps/server/src/groups/*.test.ts`
- `apps/web/src/components/group-info/MemberRow.tsx`
- `apps/mobile/src/components/group-info/members-page.tsx`
- `apps/mobile/src/components/group-info/member-menu.tsx`
- `apps/mobile/src/store/effects/group-actions.ts` (fix round 1, added by the lead)
- `apps/mobile/src/store/types-groups.ts` (fix round 1)
- `apps/mobile/src/store/effects/groups.ts` (fix round 1)
- `apps/mobile/src/lib/groups-api.ts` (fix round 1)
- `apps/server/src/groups/api.ts` (fix round 1)
- `work/T-1741-group-admins.md`

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/groups --reporter=dot
pnpm gate
```

### Acceptance
- **The owner of a group** can make a member an admin and remove admin, on web and phone. The admin mark appears and disappears.
- **Server rules:** non-owners are refused, and channels keep working.
- **The gate passes.**

---

## Report (written by the worker when done)

### What I did
- **Server, `apps/server/src/groups/member-roles.ts`:** removed the T-0124
  `group.kind !== 'channel'` 404 guard, so `changeMemberRole` now serves plain
  groups as well as channels. Every other rule is unchanged: owner-only (a
  non-member/non-owner still gets the same 404 as an unknown group), the owner
  can't be demoted or demote themselves, the channel last-admin check still
  runs only when `kind === 'channel'`, the room affiliation step runs for both
  kinds, the channel voice sync stays channel-only, and the audit entry
  (`group.role_changed`, ids and roles only) is unchanged. Updated the header
  comment on the function and dropped the stale channel-only comment.
- **Web, `apps/web/src/components/group-info/MemberRow.tsx`:** added a
  **Make admin** / **Remove admin** item to the owner's ⋮ menu for another
  member (not the owner, not yourself), before **Make owner**. It calls the
  existing store action `changeChannelRole` (web `lib/api/groups.ts`
  `changeGroupMemberRole`, which refreshes the group detail and the chat list),
  same item style as the channel menu (`ShieldCheck` / `ShieldOff`, no emoji).
- **Phone, `apps/mobile/src/components/group-info/members-page.tsx`:** the same
  two items in the owner's action sheet, calling the existing store action
  `changeChannelRole` (mobile `groups-api.ts:140` `changeGroupMemberRole`),
  which reloads the group detail (so the admin mark appears and disappears).
  Added a `role` write kind and its fixed error sentence. The file is 380 lines,
  under the 400 limit, so no `member-menu.tsx` was created.
- **Test, `apps/server/src/groups/member-roles.test.ts` (new):** the owner of a
  plain group makes a member admin and back (200, role flips in the detail); a
  non-owner gets the same 404 as an unknown group.

### Checks run
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups`
  → **6 test files passed, 38 tests passed** (was 5 files; the new
  `member-roles.test.ts` adds 2).
- `pnpm gate` (from the repo root) → summary lines:
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (0.9s)
  PASS  lint  (1.3s)
  PASS  typecheck  (7.3s)
  PASS  effect  (1.1s)
  SKIP tests @zilar/mobile (no nearby test files)
  PASS  tests @zilar/server  (11.5s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  The 5 changed files are exactly the Allowed ones: `member-roles.ts`,
  `member-roles.test.ts`, `MemberRow.tsx`, `members-page.tsx`,
  `work/T-1741-group-admins.md`.

### Notes for the lead
- I did not touch `apps/server/src/groups/api.ts` (not in Allowed files), so its
  route comment still reads "channels only" — now stale. Worth fixing in a
  follow-up.
- The role change reuses the existing store actions named `changeChannelRole`
  (web and phone); they are already generic (they call the shared
  `changeGroupMemberRole` route). I did not rename them because their files are
  outside Allowed files. One cosmetic side effect of the web reuse: the store's
  fallback error text is "This channel is not available yet." ("This group is
  not available yet." is used by `transferGroupOwner`); it only shows when the
  group detail is missing.
- UI was not run in a browser/emulator (phone smoke and Julio's live check cover
  that, per AGENTS.md); the change is a small menu addition on top of the
  existing channel flow.
- No new dependencies, no migrations, no secrets. The role UPDATE stays scoped
  by `group_id AND user_id`.

### Fix round 1 (lead review)

Two commits, one per item.

**Item 1 — phone used a chat id for a group id (real bug).** The group-info
screen passes a real GROUP id, but `changeChannelRole` resolves a CHAT id via
`h.groupIdForChat`. For a plain group no chat has `id === groupId`, so the write
failed with "This channel is not available yet.".
- Added a group-id action `changeGroupMemberRole(groupId, userId, role)` in
  `apps/mobile/src/store/effects/group-actions.ts`, mirroring `transferGroupOwner`:
  call `groupsApi.changeGroupMemberRole`, then `ensureGroupDetail(groupId, true)`,
  then `refreshQuietly`. Declared it in `apps/mobile/src/store/types-groups.ts`
  next to `transferGroupOwner` and added it to the action union in
  `apps/mobile/src/store/effects/groups.ts` next to `'transferGroupOwner'`.
- `members-page.tsx` now calls `changeGroupMemberRole` instead of
  `changeChannelRole`. Commit `e48e90d17`.

**Item 2 — stale "channels only" comments.**
- `apps/server/src/groups/api.ts` (`changeRole` route comment),
  `apps/mobile/src/lib/groups-api.ts` (`changeGroupMemberRole` doc),
  `apps/mobile/src/store/effects/group-actions.ts` (`changeChannelRole` comment),
  plus the `changeChannelRole` doc in `apps/mobile/src/store/types-groups.ts`
  (same "channels only" wording; it is an Allowed file this round, so I fixed it
  too — tell me if you'd rather I had not). Commit `086749964`.

**Checks**
- `pnpm gate` (from the repo root), after both commits:
  ```
  gate: 10 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.5s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.8s)
  PASS  effect  (0.5s)
  PASS  tests @zilar/mobile  (4.1s)
  PASS  tests @zilar/server  (10.2s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
  (10 = the 5 files of the first round plus the 5 fix-round files; the mobile
  package now has nearby test files, so `tests @zilar/mobile` runs and passes.
  The first-round notes above that said api.ts was untouched are superseded.)

**Notes for this round**
- The web path is unchanged (its `MemberRow` already passes the chat id), so
  only the phone needed the new group-id action.
- I did not rename the channel-id action `changeChannelRole` (the channel screen
  still needs it); `members-page.tsx` uses the new group-id action, and the
  channel screen keeps the old one.
- Still no browser/emulator run (phone smoke / live check cover the UI).

## Review (written by Claude)

- **Accepted at `22f7f9abc`.** The pre-review is clean after fix round 1 (1 nit, 2 follow-ups) and the packet is current. The lead ran `member-roles.test.ts`: 2 passed.
- **The server:** `changeMemberRole` now serves plain groups. The owner-only 404, the owner and self-demote 403s and the channel last-admin rule are unchanged, and the payload schema only allows `admin | member`.
- **Fix round 1 (from the lead):**
  - The problem: the phone group-info screen passes a real group id (`app/group/[id].tsx:45`, `:235`), but `changeChannelRole` resolves a chat id through `groupIdForChat`, so Make admin would have failed on the phone.
  - The fix: a group-id action, `changeGroupMemberRole`, mirroring `transferGroupOwner`, plus the stale "channels only" comments.
- **Web** passes the chat id and keeps `changeChannelRole`.
- **Follow-ups:**
  - the web fallback error still says "channel" (`groupSettings.ts:107`);
  - the existing channel last-admin race (`queries.ts:122-143`).

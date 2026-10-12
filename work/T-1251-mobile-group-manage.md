---
id: T-1251
title: "TG-7 groups mobile: the group's 'Members and roles' sheet gets a manage section — Leave group (non-owners), Make owner (owner, on a member), Delete group (owner, typed-name confirm) — on the existing routes (removeMember self / leaveChannel, transferOwner, T-1243 deleteGroup)"
status: merged
milestone: M5
branch: task/T-1251-mobile-group-manage
model: auto
effort: default
depends_on: [T-1243]
estimate: 0.4 day
---

# T-1251: Leave, Make owner and Delete group (mobile)

## Spec (written by Claude, do not edit)

### Why
It's item 7 of the Telegram parity fix plan (`docs/audit/telegram-parity-audit.md` §4). The web has Leave group (T-1183), Make owner (T-1190) and Delete group (T-1243) in `apps/web/src/components/GroupMembersSection.tsx`; mobile has none of them.
- **The mobile group screen** (`apps/mobile/src/app/group/[id].tsx`, 347 lines) opens "Members and roles" from the header (`apps/mobile/src/components/chat/group-header.tsx:58`), which shows `apps/mobile/src/components/chat/group-roles-sheet.tsx` (343 lines).
- **The mobile store already has `leaveChannel`** (`apps/mobile/src/store/types-groups.ts:139`, `apps/mobile/src/store/effects/group-actions.ts:244`).
- **The routes:** `transferOwner` = PUT `/groups/:id/owner`, and `deleteGroup` = DELETE `/groups/:id` (T-1243), both in `packages/api-contract/src/groups.ts`. A room-destroyed presence already drops the chat on every device (T-1243, xmpp-core).

### What to build
1. **The new `apps/mobile/src/components/chat/group-manage-section.tsx`,** rendered at the bottom of the roles sheet (add at most ~5 lines to `group-roles-sheet.tsx`):
   - **Leave group** for a non-owner. The in-sheet confirm reads "Leave {group}? You can rejoin only with an invite." Leaving calls the store's `leaveChannel` (or the web's equivalent; read `GroupMembersSection.tsx:101-115` and match it), then closes the screen with `goBackOrHome`.
   - **For the owner:** a short line, "Owners can't leave. Make someone else owner first.", plus **Make owner** on each member row (or a picker in the section). Its confirm reads "Make {name} the owner? You become an admin." It refreshes the group afterwards.
   - **Delete group** for the owner, in danger colour. The confirm needs the group name typed and reads "Delete {group} for everyone? All topics and messages go away. This can't be undone." Success goes back home, and a failure shows one line.
   - No `Alert.alert`.
2. **Store and API:** add `transferGroupOwner(groupId, userId)` and `deleteGroup(groupId)` to the mobile store's group actions (`types-groups.ts`, `effects/group-actions.ts`) on the typed client, the same way the existing role actions are built (cite one). Keep every file at most 400 lines.
3. **Mock backend:** the groups routes already serve the web's transfer and delete (T-1243 added delete). Check that and cite it.
4. **No tests** (UI; the server routes are tested).

### Read first
`AGENTS.md`, `apps/web/src/components/GroupMembersSection.tsx`, `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/components/chat/group-header.tsx`, `apps/mobile/src/store/types-groups.ts`, `apps/mobile/src/store/effects/group-actions.ts` and `packages/api-contract/src/groups.ts`.

### Allowed files
`apps/mobile/src/components/chat/group-manage-section.tsx`, `apps/mobile/src/components/chat/group-roles-sheet.tsx`, `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/store/types-groups.ts`, `apps/mobile/src/store/effects/group-actions.ts`, `apps/mobile/src/store/effects/groups.ts`, `apps/mobile/src/lib/groups-api.ts`, `apps/mobile/src/lib/chat-api.ts`, `packages/mock-backend/src/domains/groups/**`, `work/T-1251-mobile-group-manage.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes, and every touched file stays at most 400 lines.
- **The lead's check on the emulator (mock build):**
  - Familia (owned by You): the sheet shows Delete group and Make owner;
  - Dev team (You aren't the owner): it shows Leave group.

---

## Report (written by the worker when done)

**Result:** implemented; `pnpm gate` green.

### What I did

- **New `apps/mobile/src/components/chat/group-manage-section.tsx`** (the manage
  block appended to the members-and-roles sheet):
  - Non-owner: `Leave group` with the in-sheet confirm `Leave {group}? You can
    rejoin only with an invite.`
  - Owner: the line `Owners can't leave. Make someone else owner first.`, a
    `Make owner` picker (one row per non-owner member) with the confirm
    `Make {name} the owner? You become an admin.`, and a destructive
    `Delete group` with a typed-name confirm (`Delete {group} for everyone? All
    topics and messages go away. This can't be undone.`).
  - No `Alert.alert`; a failure shows one fixed line inside the section.
- **`group-roles-sheet.tsx`**: renders the section at the bottom and takes one
  `manage` prop (10 added lines, no other change).
- **`app/group/[id].tsx`**: owns the manage state (busy/error) and calls the
  store; leave and delete leave the screen with `goBackOrHome`, a successful
  transfer reloads the detail in the store (so the caller repaints as admin and
  `Leave group` appears). Closing the sheet is blocked while a manage write runs.
- **Store**: `transferGroupOwner(groupId, userId)` and `deleteGroup(groupId)` in
  `types-groups.ts`, implemented in `effects/group-actions.ts` and listed in
  `effects/groups.ts`, on the typed client the same way the existing role
  actions are built (cite: `deleteGroupRole`, `effects/group-actions.ts:341`,
  which calls `rolesApi.deleteGroupRole` through `lift`). `transferGroupOwner`
  reloads the detail and refreshes the chat list; `deleteGroup` refreshes the
  chat list.
- **`lib/groups-api.ts`**: `transferGroupOwner` (`PUT /groups/:id/owner`) and
  `deleteGroup` (`DELETE /groups/:id`) on the derived client.
- **Mock backend**: `DELETE /groups/:id` was already served
  (`domains/groups/routes.ts:49`, `deleteGroup` at `:311`). The **transfer route
  was not** — nothing handled `PUT /groups/:id/owner`, so the mock would have
  404'd `Make owner`. I added `transferOwner` in `routes.ts` with the server's
  rules (owner-only 403, unknown caller the missing-404, self 400, target must
  be a member else 404).

### Commands and real results

- `pnpm install`: done (13.5 s).
- `pnpm gate` (first run): **GATE FAIL** — `format` on
  `group-manage-section.tsx`, and `scope` flagged
  `apps/mobile/src/components/chat/use-group-roles.ts` (not in the Allowed
  files). Fixed both: the manage wiring now lives in the allowed screen
  (`app/group/[id].tsx`) instead of the hook, and I reverted that hook; ran
  Prettier on the new file.
- `pnpm gate` (final): `PASS install`, `PASS format`, `PASS lint`,
  `PASS typecheck`, `PASS effect`, `PASS tests @zilar/mobile`;
  `SKIP tests @zilar/mock-backend (no nearby test files)`;
  `scope: every changed file is inside the Allowed files`; **GATE PASS**.
- I ran no single test files: there are none next to the changed files, and the
  spec says UI gets no tests. The gate ran the mobile package's nearest tests.

Touched files (all ≤ 400 lines): `group-manage-section.tsx` (new),
`group-roles-sheet.tsx`, `app/group/[id].tsx`, `store/types-groups.ts`,
`store/effects/group-actions.ts`, `store/effects/groups.ts`, `lib/groups-api.ts`,
`packages/mock-backend/src/domains/groups/routes.ts`.

### Deviations / problems

- The spec says the mock "already serve[s] the web's transfer and delete"; only
  delete was served, so I added the transfer route (inside the Allowed mock
  folder).
- The acceptance says "Dev team (You aren't the owner)", but the shared mock
  seed has `u-you` as the owner of Dev team (`g-devteam`) in both
  `packages/mock-backend/src/domains/groups/seed.ts:32-46` and
  `packages/mock-backend/src/domains/chats/seed.ts:28-37`. So Dev team shows the
  owner controls. A non-owner check should use a group where `u-you` is not the
  owner, e.g. Gym buddies (`g-gym`, member) or QA squad (`g-qa`, admin). I did
  not touch the seed: `domains/chats/**` is outside my Allowed files.

### Open question

- Confirm the non-owner acceptance group, or whether the seed should change.

### Round (fix round 1 — PREREVIEW findings)

- **Finding 1 (should-fix) — fixed.** `app/group/[id].tsx` was 402 lines, over
  the spec's 400-line cap. Moved the `runManageWrite`/`manage` wiring out of the
  screen into a new `useGroupManage({ groupId, groupChatId, isOwner })` hook in
  `components/chat/group-manage-section.tsx` (an allowed file). The screen now
  calls the hook in one line; behaviour is unchanged (same store actions, same
  fixed error sentences, same `goBackOrHome` on leave/delete). Now: screen 358
  lines, section 308 lines — both ≤ 400.
- **Findings 2–5 (nits) — left as-is.** None is in a line this round changes, so
  per the fix-round rules they are untouched. No disagreement with them.
- **Tests added:** none. Finding 1 is a structural (line-count) fix, not a
  behaviour fix, and names no test; the spec says "No tests" and UI gets no tests.
- **Gate:** `PASS install`, `PASS format`, `PASS lint`, `PASS typecheck`,
  `PASS effect`, `PASS tests @zilar/mobile`;
  `SKIP tests @zilar/mock-backend (no nearby test files)`;
  `scope: every changed file is inside the Allowed files`; **GATE PASS**.

## Review (written by Claude)

**Lead, 2026-10-12: approved. Pre-review clean after 1 auto round (1 follow-up).**
- **The change:**
  - a new `group-manage-section.tsx` (308 lines) at the bottom of the members sheet;
  - store actions `transferGroupOwner` and `deleteGroup` on the typed client;
  - mock routes for transfer and delete.
- **Lead's emulator check (mock build, SMOKE PASS, Familia owned by You):**
  - Members and roles shows a Manage section: "Owners can't leave. Make someone else owner first.", Make owner, and Delete group in danger colour;
  - Delete group opens "Delete Familia for everyone? All topics and messages go away. This can't be undone." with the name field; the button stays disabled until the name is typed;
  - Cancel works.
- **Not checked:** Leave group for a non-owner, because every mock group is owned by You (F1: the mock seed). Check it on the next APK in a group Julio doesn't own.

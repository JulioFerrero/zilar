---
id: T-1552
title: "Phone Group info root (plan docs/audit/phone-group-info-plan.md T1; board group-info/Phone.dc.html): tapping the group header opens a full-screen Group info with picture, name, one members+AIs count, Mute/Search/Add/More keys, People rows (Members, Invite links), a Settings row and a red Leave group row; the group header's count becomes one combined number"
status: merged
milestone: M5
branch: task/T-1552-mobile-group-info-root
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1552: Phone Group info root

## Spec (written by Claude, do not edit)

### Why
Julio approved Group info on 2026-10-15. Read `docs/design/mockups/group-info/README.md` and `Phone.dc.html`, and the audit `docs/audit/phone-group-info-plan.md` (§1, §2, §4; this is its **T1**; the lead's answers are in T-1542's Review).

The phone has no Group info screen today; its group header opens three sheets. This task adds the root and its navigation. Later tasks add the Members and AIs pages (T2), the content pages (T3), Settings (T4) and channel info (T5–T6).

### Facts (from the audit, re-checked by the lead on main, 2026-10-15)
- **`apps/mobile/src/app/group/[id].tsx` (359 lines):**
  - the group screen;
  - `groupChatId` is the General topic's id (`:84`); the members and AIs come from `groupDetail` (`:96-97`);
  - `useGroupManage({ groupId, groupChatId, isOwner })` is at `:121`;
  - `GroupHeader` is at `:225-239`, with `topicsHeaderSubtitle({ memberCount, aiCount, topicCount })`;
  - the links, visibility and roles hooks open their sheets.
- **`apps/mobile/src/components/chat/group-header.tsx` (66 lines):** back, avatar, title and subtitle (`:36-50`), and the keys Invite links, Visibility and Members (`:51-63`).
- **`topicsHeaderSubtitle`** (`apps/mobile/src/lib/topics.ts`) prints "N members, N AIs, N topics".
- **`apps/mobile/src/components/chat/group-manage-section.tsx` (301 lines):** owner gets Make owner and Delete group (typed name); non-owner gets Leave group.
- **Mute:** `setChatPref(chatId, { mutedUntil })`. See `apps/mobile/src/components/chat/channel-composer-bar.tsx:83-90` for a mute toggle.
- **Search in a chat:** `router.push({ pathname: '/', params: { searchChat: chatId } })` (the chat screen does this).

### Lead decisions (T-1542 Review)
- Tapping the group header's picture or title opens Group info. The three header keys **stay** until T4.
- **Mute** mutes the group's own chat row, which on the phone is `groupChatId` (General), forever or unmute.
- **Counts:** the root shows people + AIs. The group header subtitle shows the same combined count as "N members, N topics". The Members row shows people, and the AIs row (T2) its own count. Only already-loaded counts are shown; a count that isn't loaded shows no number.

### Steps
1. **New route `apps/mobile/src/app/group-info/[id].tsx`** (id = group id): loads the group detail like the group screen (`ensureGroupDetail`), and renders `GroupInfoRoot`.
2. **New `apps/mobile/src/components/group-info/root-page.tsx`** after `Phone.dc.html`:
   - a Back key;
   - a 96 px group picture (`EntityAvatar` of the group chat);
   - the name, 22 px semibold;
   - "N members", where N = people + AIs.
3. **New `apps/mobile/src/components/group-info/info-keys.tsx`:** four 40 px `IconButton` keys with labels under them (the board style):
   - **Mute / Unmute:** `BellOff`/`Bell`, toggling `setChatPref(groupChatId, { mutedUntil })`. An error shows one line.
   - **Search:** opens the message search on `groupChatId`.
   - **Add:** managers only; opens the existing invite links sheet for now (T2 swaps in Add members).
   - **More:** owner only; a sheet with "Delete group" (red), which opens the existing typed-name delete from `group-manage-section.tsx`. Hide the key when it would be empty.
4. **New `apps/mobile/src/components/group-info/info-row.tsx`:** a 48 px row with a 34 px icon tile, the label, an optional mono count and a chevron, grouped in rounded lists. The root holds:
   - **People:** "Members" (people count; opens the existing members and roles sheet), and "Invite links" (managers; opens the existing invite links sheet).
   - **Settings:** "Settings" (opens the existing visibility sheet for now; T4 builds the page).
   - **Bottom:** a red "Leave group" row for non-owners, using the existing leave flow and its confirm.
   
   No headings inside the lists and no hint text.
5. **`group-header.tsx`:** the picture and title become one pressable (`accessibilityLabel` "Group info") calling a new `onOpenInfo`. Keep the three keys.
6. **`apps/mobile/src/app/group/[id].tsx`:**
   - pass `onOpenInfo={() => router.push({ pathname: '/group-info/[id]', params: { id: groupId } })}`;
   - the subtitle uses the combined count: change `topicsHeaderSubtitle` to take `memberCount` = people + AIs and print "N members, N topics";
   - keep the file under 400 lines.
7. **Reuse the existing sheets and hooks** in the info route (mount the same sheet components there). Never copy their logic, and keep every file under 400 lines.

### Not in scope
- Members and AIs pages (T2);
- content pages (T3);
- the Settings page and removing the header keys (T4);
- channels (T5–T6);
- web;
- the server.

### Tests
None (UI).

### Allowed files
- `apps/mobile/src/app/group-info/[id].tsx` (new)
- `apps/mobile/src/components/group-info/root-page.tsx` (new)
- `apps/mobile/src/components/group-info/info-keys.tsx` (new)
- `apps/mobile/src/components/group-info/info-row.tsx` (new)
- `apps/mobile/src/components/chat/group-header.tsx`
- `apps/mobile/src/app/group/[id].tsx`
- `apps/mobile/src/lib/topics.ts` (only `topicsHeaderSubtitle`)
- `work/T-1552-mobile-group-info-root.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/group-info/g-devteam`:** Back, the Dev team picture, "Dev team", "8 members", the four keys (Mute, Search, Add, More, as the mock user's role allows), the Members and Invite links rows, Settings, and Leave group when the mock user is not the owner.
- **`/group/g-devteam`'s header** reads "8 members, 7 topics".

---

## Report (written by the worker when done)

### What I did

New full-screen Group info root and its navigation, after `Phone.dc.html`, reusing the
existing hooks and sheets.

- **`apps/mobile/src/app/group-info/[id].tsx` (new, 232 lines):** the route. Loads the group
  detail with `ensureGroupDetail`, derives the title and the group's own chat row (the General
  topic) from the chat list like the group screen, and wires `useGroupManage`,
  `useGroupRoles`, `useGroupInviteLinks` and `useGroupVisibility`. Renders `GroupInfoRoot` and
  mounts the existing `InviteLinksSheet`, `GroupRolesSheet` and `VisibilitySheet` (unchanged),
  plus the More action sheet and the Leave/Delete confirms.
- **`apps/mobile/src/components/group-info/root-page.tsx` (new, 140 lines):** back key, 96 px
  `EntityAvatar`, the name at 22 px semibold and the combined `N members` count, the four keys
  (`InfoKeys`), the People group (Members with the people count; Invite links for managers), the
  Settings group (managers), and the red Leave group row for non-owners. Counts are hidden until
  the detail is loaded (lead's rule), so nothing shows a `0` it does not know.
- **`apps/mobile/src/components/group-info/info-keys.tsx` (new, 116 lines):** the four 40 px
  `IconButton` keys with labels under them. Mute/Unmute flips the group's own chat row with
  `setChatPref(groupChatId, { mutedUntil })` (forever or unmute) and shows one fixed-sentence
  error line; Search pushes `/?searchChat=<groupChatId>`; Add is managers-only and opens the
  invite-links sheet for now; More is owner-only (hidden when it would be empty).
- **`apps/mobile/src/components/group-info/info-row.tsx` (new, 87 lines):** `InfoRow` — a 48 px
  row with a 34 px `IconTile`, the label, an optional mono count and a chevron — plus the
  `danger` variant (the red Leave group row: 18 px icon, no tile/chevron/count) and the rounded
  `InfoRowGroup` list with hairline separators.
- **`apps/mobile/src/components/chat/group-header.tsx`:** the picture and title are now one
  `Pressable` with `accessibilityLabel` "Group info" that calls the new `onOpenInfo`; the back
  key and the three existing keys stay and work as before.
- **`apps/mobile/src/app/group/[id].tsx`:** passes `onOpenInfo` (pushes `/group-info/[id]`) and
  the subtitle now uses one combined count — people + AIs — via `topicsHeaderSubtitle`
  (`groupAis.length` folded in). File is 361 lines.
- **`apps/mobile/src/lib/topics.ts`:** `topicsHeaderSubtitle` now takes `{ memberCount,
  topicCount }` and prints "N members, N topics" (the `aiCount` option is gone; its only caller
  was the group screen).

### Checks run

- `pnpm install` (from the repo root): "Done in 14.1s". One pre-existing peer warning
  (`@types/react-dom` vs `@types/react`), unrelated to this change.
- No single test file was run: none of the touched files has a colocated test (the change is
  UI). The gate ran the mobile package tests on its own.
- `pnpm gate` (from the repo root), first run ended `GATE FAIL` on `format` for 3 of the changed
  files. I ran `pnpm exec prettier --write` only on the files I touched and re-ran the gate. Final
  run:

      gate: 8 changed file(s) against main
      PASS  install (frozen)  (1.8s)
      PASS  format  (0.9s)
      PASS  lint  (1.7s)
      PASS  typecheck  (6.8s)
      PASS  effect  (1.9s)
      PASS  tests @zilar/mobile  (3.9s)
      scope: every changed file is inside the Allowed files
      migration: every added migration continues from the base
      images: every workspace package an app image needs is copied into Dockerfile
      size: every changed source file is within 400 lines
      GATE PASS

### Notes for the lead

- **Settings row gating.** The root shows the Settings row to the owner only, because in T1 it
  opens the owner-only visibility sheet. Web `GroupInfoRoot.tsx:265-277` gates it on
  `isManager`, but that row opens the full Settings page there; T4 builds the phone page and
  can widen the row again. The route also guards the sheet opens on the local role (see the
  Round section).
- **Delete reuse (deviation).** More opens an `ActionSheet` whose "Delete group" item (red)
  opens a typed-name confirm that reuses the existing flow — `useGroupManage` in
  `group-manage-section.tsx` (`onDelete`, `busy`, `error`) — but the confirm view itself is in
  the route. I could not mount the existing `GroupManageSection` delete alone: it always renders
  Make owner and the "Owners can't leave" hint together with Delete, and
  `group-manage-section.tsx` is not in this task's Allowed files. Say the word and I will swap
  the route confirm for the full `GroupManageSection` in the More sheet.
- **Leave confirm.** The red Leave row uses the kit `ConfirmDialog` (not the inline
  `GroupManageSection` buttons, which are not a red row) and `useGroupManage.onLeave` for the
  write/navigation/error.
- **Mute.** Forever or unmute on `groupChatId`, exactly as the lead answered; the error line
  reuses the web sentence "Could not update notifications. Try again.".
- **Header count fallback.** On the group screen the combined count falls back to the summary's
  `general.memberCount` (people) plus the loaded AI count before the detail lands, so the header
  never flashes 0. The info root instead hides both counts until the detail is loaded, per the
  "a count that isn't loaded shows no number" rule.
- **Duplication kept on purpose:** the Members row opens the existing `GroupRolesSheet`
  unchanged, which still carries its own manage section (Leave/Make owner/Delete), so an owner
  sees Delete in both the roles sheet and More until T2/T4 split it.
- All 8 changed files are inside the Allowed files. No blockers.

### Round (fix round against PREREVIEW.md)

- **Finding 1 (should-fix) — fixed.** The route now opens the Add/Invite-links sheets only when
  `isManager` and the Settings sheet only when `isOwner`, through guarded `openLinks` /
  `openSettings` handlers, so a hidden key or row can never open a manager- or owner-only sheet.
  The Settings row in `root-page.tsx` is now gated on `isOwner` (not `isManager`), because it
  opens the owner-only visibility sheet — that closes the concrete "a non-owner opens the
  owner-only visibility sheet via Settings" failure (the group screen already gates its
  Visibility key on `mayChangeVisibility` = owner, so this matches it). The Add key and Invite
  links row were already hidden for non-managers in `root-page.tsx`; the route guard is the
  defence-in-depth the finding asked for.
- **Findings 2 and 3 (nits) — not touched.** Finding 2 is in `apps/mobile/src/app/group/[id].tsx`
  (header count fallback) and finding 3 in `info-keys.tsx` (mute paint derivation); neither line
  is changed by this round, and both are disclosed nits the reviewer accepted.
- **Tests:** none added. The Spec says "Tests: None (UI)"; the finding names no test; and the
  mobile package has no component-render test harness (no `*.test.tsx`), only logic tests. Per
  `AGENTS.md` ("UI code gets no tests"), this stays a UI-only change.
- **Files changed this round:** `apps/mobile/src/app/group-info/[id].tsx`,
  `apps/mobile/src/components/group-info/root-page.tsx`.
- **Gate:** `pnpm gate` from the repo root, final run:

      gate: 8 changed file(s) against main
      PASS  install (frozen)  (2.3s)
      PASS  format  (2.3s)
      PASS  lint  (2.3s)
      PASS  typecheck  (5.8s)
      PASS  effect  (1.4s)
      PASS  tests @zilar/mobile  (3.5s)
      scope: every changed file is inside the Allowed files
      migration: every added migration continues from the base
      images: every workspace package an app image needs is copied into Dockerfile
      size: every changed source file is within 400 lines
      GATE PASS

Status stays `review`.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one autopilot round, with 4 nits.
- **Phone smoke** (mock): PASS.
  - **`/group-info/g-devteam`:**
    - a back key, the round group picture, "Dev team" and "6 members" (4 people + 2 AIs, the same as web);
    - the Mute, Search, Add and More keys;
    - Members `4` and Invite links, then Settings, all in one rounded list each.
  - **`/group/g-devteam`:** the header reads "6 members, 7 topics" and keeps its keys until T4, per the plan's answers.
- **The nits:**
  - **Into T2:**
    - nit 4: the Leave text differs from `group-manage-section.tsx:289` ("You can rejoin only with an invite.");
    - nit 2: before chats load, Mute and Search use the raw group id.
  - **Left as they are:**
    - nit 1: the header count may briefly mix the cached summary with the detail;
    - nit 3: the mute paint follows the existing convention.

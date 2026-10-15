---
id: T-1508
title: "Web Group info step 2 (approved canvas): More key (Group background, Delete group), red Leave group row at the root bottom, redrawn member rows (owner/admin icons, role tags under the name, ⋮ menu), Members page search and add rows"
status: merged
milestone: M5
branch: task/T-1508-web-group-info-step2
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1508: Web Group info, step 2

## Spec (written by Claude, do not edit)

### Why
Julio approved the Group info design on 2026-10-15. The boards are in `docs/design/mockups/group-info/`; read `README.md`, then `Main.dc.html` and `WebMembers.dc.html`.

Step 1 (T-1494, merged) built the root page and the subpages. Its spec said step 2 "moves Leave and Delete, adds More, and redraws the member rows". The README rules:
- **More** opens a menu of rare actions: Group background (managers) and Delete group (the owner). A member with neither doesn't see the key.
- **The red bottom row** is Leave group, shown to non-owners only. The owner deletes from More.
- A status is an icon, never a word.

The T-1494 Review also noted an older bug: on the Members page, the second member row shows its role tags but no name. The name is `flex-1 min-w-0 truncate` while the tags beside it never shrink, so the tags squeeze the name to nothing. Putting the tags under the name (the board) fixes it.

### Facts (the lead read them on main, 2026-10-15)
- **`apps/web/src/components/group-info/GroupInfoRoot.tsx` (224 lines):**
  - the keys row is at `:119-128`: Mute/Unmute, Search, and Add for managers (`PanelKey`);
  - the lists end at `:207-219`, with the Settings group for managers.
  - There is no More key and no Leave row.
- **`apps/web/src/components/GroupPanel.tsx` (369 lines, near the limit):**
  - the members page is at `:202-228`: `GroupMembersSection` and, for managers, `GroupRolesSection`;
  - on the settings page, the "Group background" `ListRow` (managers) is at `:330-340`;
  - `ChatBackgroundDialog` is at `:360-366`, with state `backgroundOpen` at `:68-69`;
  - `isOwner` is at `:160`.
- **`apps/web/src/components/GroupMembersSection.tsx` (367 lines, near the limit):**
  - leave: `leaveGroup` `:105-114`, uses `storeApi.getState().leaveChannel(chatId)`, then `onClose()` and `navigate('/')`;
  - delete: `deleteGroupNow` `:118-130`, uses `deleteGroup(info.id)`, then `refreshChats()`, `onClose()` and `navigate('/')`;
  - the member rows are at `:135-226`: name and tags in one line, plus the word buttons "Make owner", "Remove" and "Cancel";
  - the "To leave, make someone else the owner first." hint is at `:241-245`;
  - the inline delete confirm, with the typed name, is at `:246-280`, and the "Delete group" button at `:281-294`;
  - the Leave button is at `:295-320`;
  - the Add members picker `Dialog` is at `:321-354`;
  - `RoleChip` is at `:359-366`.
- **The kit:**
  - `ui/panel-key.tsx` (`PanelKey`);
  - `ui/icon-button.tsx`;
  - `ui/menu.tsx` (`Menu`, `MenuItem` with `icon`, `onSelect` and `destructive`);
  - `ui/list-row.tsx` (`ListRow` with `danger`);
  - `ui/dialog.tsx`;
  - `ui/search-field.tsx`;
  - `apps/web/src/components/ConfirmDialog.tsx`, as used in `apps/web/src/routes/SettingsHubPage.tsx:130-141`.
  - The pattern for a ⋮ menu is `apps/web/src/components/sticker/PackMenu.tsx`.

### What to build
1. **New `apps/web/src/components/group-info/GroupExit.tsx`.** Move the leave and delete logic out of `GroupMembersSection` into this file:
   - a `LeaveGroupRow`: a red `ListRow` (`danger`, `LogOut` icon, "Leave group") in its own rounded group, opening a `ConfirmDialog` ("Leave <title>?", confirm "Leave");
   - a `DeleteGroupDialog`: the existing warning text, the type-the-name `TextInput`, and Delete/Cancel, in a `Dialog`.
   - Same calls and same after-steps as today. Errors show in the dialog.
2. **`GroupInfoRoot.tsx`:**
   - **More key:** a fourth `PanelKey`, "More" (`MoreHorizontal`), shown when the user is a manager or the owner. It opens a `Menu` with "Group background" (`Image`, managers), which opens the existing `ChatBackgroundDialog`, and "Delete group" (`Trash2`, `destructive`, owner only), which opens `DeleteGroupDialog`.
   - **Bottom row:** `LeaveGroupRow` for any member who is not the owner.
   - Pass in what it needs (`isOwner`, the group id and title, `onOpenBackground`) from `GroupPanel`.
3. **`GroupPanel.tsx`:**
   - remove the "Group background" row from the settings page (it lives under More now) and keep the dialog state here;
   - keep the file under 400 lines.
4. **New `apps/web/src/components/group-info/MemberRow.tsx`, the row from `WebMembers.dc.html`:**
   - a 36 px `EntityAvatar` and the name;
   - right after the name, an Owner icon (lucide `Crown`, 14 px, `text-[#e5b84b]`, `role="img"`, `aria-label="Owner"`) or an Admin icon (`Shield`, 14 px, muted, `aria-label="Admin"`). No role word;
   - the custom role tags on a second line under the name (`RoleChip`, moved here);
   - a ⋮ `IconButton` ("Options for <name>") when there is an action. It opens a `Menu` with:
     - "Make owner" (owner only, never on yourself), which confirms with a `ConfirmDialog` ("Make <name> the owner? You become an admin.");
     - "Remove" (managers, never on the owner or yourself, `destructive`), which confirms with a `ConfirmDialog`.
   - Same calls as today (`transferGroupOwner`, `removeGroupMember`).
5. **`GroupMembersSection.tsx`:**
   - render the members as one rounded group (`divide-y divide-divider overflow-hidden rounded-xl border border-border bg-surface`) of `MemberRow`s;
   - at the top, a `SearchField` that filters members by name or handle;
   - for managers, an "Add members" `ListRow` (`UserPlus`) that opens the existing picker, and an "Invite with a link" `ListRow` (`Link`) that opens the Invite links page. Add an `onOpenLinks` prop; `GroupPanel` passes `() => setPage('links')` or its equivalent;
   - remove the leave and delete UI and the owner hint (moved to step 1's files);
   - the section heading "Members" goes away (the page title says it).
6. Keep Roles where it is, at the end of the Members page. The AIs keep their own page.

### Not in scope
- the channel pages (step 3);
- the mobile app;
- the server.

### Tests
None (UI, CLAUDE.md Hard rules).

### Allowed files
- `apps/web/src/components/group-info/GroupExit.tsx` (new)
- `apps/web/src/components/group-info/MemberRow.tsx` (new)
- `apps/web/src/components/group-info/GroupInfoRoot.tsx`
- `apps/web/src/components/GroupPanel.tsx`
- `apps/web/src/components/GroupMembersSection.tsx`
- `work/T-1508-web-group-info-step2.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Root page** (`?mock=1`, Dev team › General, then `?panel=group`, at 1280 and 390 px):
  - the keys read Mute, Search, Add, More;
  - More holds Group background and Delete group for the owner;
  - a non-owner sees the red Leave group row and no Delete.
- **Members page:**
  - every row shows its name;
  - the owner and admin show as icons, with tags under the name;
  - the ⋮ menus hold Make owner and Remove;
  - Search filters.
- Every file stays under 400 lines.

---

## Report (written by the worker when done)

### What I did

**New `apps/web/src/components/group-info/GroupExit.tsx`** — leave and delete moved out of `GroupMembersSection`:
- `LeaveGroupRow`: a red `ListRow` (`danger`, `LogOut`, "Leave group") in its own rounded group; opens a `ConfirmDialog` "Leave <title>?" (confirm "Leave"). Same `storeApi.getState().leaveChannel(chatId)` call, then `onClose()` and `navigate('/')`.
- `DeleteGroupDialog`: the existing warning text and the type-the-name `TextInput` in a `Dialog`, with Delete/Cancel; the same `deleteGroup(groupId)` call, then `refreshChats()`, `onDeleted()` and `navigate('/')`. Errors show in the dialog (`Dialog`'s `error` prop).

**`apps/web/src/components/group-info/GroupInfoRoot.tsx`** — added the fourth "More" key (`MoreHorizontal`, managers/owners) with a `Menu` holding "Group background" (`Image`, managers) and "Delete group" (`Trash2`, `destructive`, owner only), and the red Leave group row at the bottom for non-owners. New props: `groupId`, `isOwner`, `canLeave`, `onOpenBackground`.

**New `apps/web/src/components/group-info/MemberRow.tsx`** — the `WebMembers.dc.html` row: a 36 px `EntityAvatar` and the name, an Owner `Crown` (`text-[#e5b84b]`) or Admin `Shield` (muted) icon on the same line with `role="img"`/`aria-label`, the custom role tags (`RoleChip`, moved here) on a second line under the name, and a ⋮ `IconButton` ("Options for <name>", the kit default 36 px / radius 10) opening a `Menu` with Make owner (owner only, never yourself) and Remove (managers only, never the owner or yourself, `destructive`), both confirming with `ConfirmDialog`. Same `transferGroupOwner` / `removeGroupMember` calls.

**`apps/web/src/components/GroupMembersSection.tsx`** — now a `SearchField` (filters by name or handle), for managers an "Add members" `ListRow` (`UserPlus`, the existing picker) and an "Invite with a link" `ListRow` (`Link` → new `onOpenLinks`), and one rounded group (`divide-y … rounded-xl border border-border bg-surface`) of `MemberRow`s. Removed the leave and delete UI, the owner hint and the "Members" heading.

**`apps/web/src/components/GroupPanel.tsx`** — removed the "Group background" row from the Settings page (the `ChatBackgroundDialog` state stays here), passes the new root props (`groupId`, `isOwner`, `canLeave`, `onOpenBackground`) and `onOpenLinks={() => setPage('links')}` to the members section.

### Checks run

- `pnpm gate` (from the repo root), run once at the end:
  ```
  gate: 6 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (1.0s)
  PASS  lint  (1.2s)
  PASS  typecheck  (6.2s)
  PASS  effect  (2.1s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- No single-file tests were run: the Spec says no tests (UI-only change) and no nearby test files exist.
- Line counts: GroupPanel 359, GroupInfoRoot 293, GroupExit 176, MemberRow 158, GroupMembersSection 175 (all < 400).

### Notes for the lead

- `PanelKey` cannot be a Base UI `Menu` trigger (it does not forward the props/ref the trigger injects) and `ui/panel-key.tsx` is not in the Allowed files, so the More key reproduces the `PanelKey` layout inline (a `w-16` column with the `IconButton` and its label) instead of rendering `<PanelKey>`.
- `ConfirmDialog` has no `error`/`busy` slot, so a failed Leave shows the fixed sentence in a `FieldError` just under the row (the same pattern `ChatActionsMenu` uses for its confirm). The Delete dialog shows its error inside the `Dialog`, as the Spec asks. If you want Leave's error inside its dialog, that needs a change to `ConfirmDialog` (outside the Allowed files).
- The Remove confirm needed a body sentence (the old inline flow had none): I used "<name> will lose access to this group." Change it if you have a preferred wording.
- "Add members" is now always shown to managers (per the Spec); before it was hidden when every contact was already a member, so the picker can now open empty.
- Search filters the member rows only (name or handle), not the AIs list.
- Review fix: the ⋮ key now uses `IconButton`'s defaults (36 px / radius 10); the earlier 32 px / radius 8 overrides are gone.

## Review (written by Claude)
Lead, 2026-10-15: approved and merged.
- **Pre-review:** clean, with nits and follow-ups only, for head `c4dc78852`, after one lead fix round (the member ⋮ key back to the kit's 36 px).
- **Headless check** (mock, Dev team › General, `?panel=group`, 1280 and 390 px):
  - **root:** the keys read Mute, Search, Add, More, and More holds Group background and Delete group for the owner;
  - **Members:** Search, then the Add members and Invite with a link rows;
  - every member row shows its name, which fixes the older bug;
  - the owner crown and admin shield are icons, with role tags under the name and ⋮ menus;
  - Roles at the end;
  - no horizontal scroll, 0 page errors.
- **Not seen:** the mock viewer is the owner, so the non-owner Leave row was read in code, not seen.
- **Nit accepted:** a failed Leave shows its error under the row, because `ConfirmDialog` has no error slot.

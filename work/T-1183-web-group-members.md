---
id: T-1183
title: "WUX-8: web group panel — a members section with Add members (contact picker, owners/admins), Remove on each row for owners/admins, and Leave group for non-owners; uses the existing server endpoints"
status: merged
milestone: M5
branch: task/T-1183-web-group-members
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1183: Manage group members on web

## Spec (written by Claude, do not edit)

### Why
`docs/audit/web-ux-audit.md` WUX-8 (P1, confirmed).
- **The panel:** `apps/web/src/components/GroupPanel.tsx:184-222` renders members as plain rows with role chips. There's no Leave group, no Add members and no Remove. Telegram has a member row menu, "Add members" and "Leave group".
- **What the server allows already:**
  - add members: `POST /api/groups/:id/members` (contract `packages/api-contract/src/groups.ts:175-178`, payload `{ userIds }` at `:44-46`), for owners and admins only (`apps/server/src/groups/members.ts:25-37`);
  - remove: owners and admins may remove others, anyone may remove themselves, and the owner can't be removed (`members.ts:116-138`).
- **What web has:**
  - `removeGroupMember` (`apps/web/src/lib/api/groups.ts:176-178`, through `callApi`), but no add call;
  - the store's `leaveChannel` (`apps/web/src/store/effects/groupSettings.ts:19-31`) already removes the current user from any group and refreshes the list;
  - the contact rows to copy are in `NewGroupDialog.tsx:186-205`.
- **Size:** `GroupPanel.tsx` is 362 lines. Move the members markup into the new section, so it shrinks.

### What to build
1. **`apps/web/src/lib/api/groups.ts`:** `addGroupMembers(groupId, userIds)`, through `callApi` and the contract's `addMembers`. Add store actions (`addGroupMembers`, `removeGroupMember`) in `groupSettings.ts` and `groupActions.ts`, following `leaveChannel`. Each refreshes the group detail and the chat list.
2. **A new `apps/web/src/components/GroupMembersSection.tsx`** (at most 250 lines), which replaces `GroupPanel.tsx:184-222`:
   - member rows, the same as today, plus for owners and admins a small Remove button on rows that aren't the owner or yourself, with an inline confirm (no `confirm()`);
   - an "Add members" button for owners and admins, opening a dialog: the contacts not already in the group, as checkboxes (copy `NewGroupDialog`), then Add;
   - "Leave group" at the bottom for non-owners, with an inline confirm, calling `leaveChannel(chatId)`. After leaving, navigate to `/`.
   - For the owner, show a muted line: "Owners can't leave yet." Transfer comes in a later task.
   - Errors show inline.
3. **No tests** (UI; the server rules are unchanged).

### Read first
`AGENTS.md`, `docs/audit/web-ux-audit.md` (WUX-8), `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/NewGroupDialog.tsx`, `apps/web/src/store/effects/groupSettings.ts`, `apps/web/src/store/effects/groupActions.ts`, `apps/web/src/lib/api/groups.ts` and `apps/server/src/groups/members.ts:20-140`.

### Allowed files
`apps/web/src/components/GroupMembersSection.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/lib/api/groups.ts`, `apps/web/src/store/effects/groupSettings.ts`, `apps/web/src/store/effects/groupActions.ts`, `apps/web/src/store/store.ts`, `work/T-1183-web-group-members.md`.

`store.ts` is 394 lines: add at most the two action type lines there. If that would pass 400, put the types on the group actions slice instead.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- Every touched file stays at most 400 lines.
- **The lead's check on the live web, with test accounts:** an admin adds and removes a member, and a member leaves.

---

## Report (written by the worker when done)

### What I did
- **`apps/web/src/lib/api/groups.ts`**: added `addGroupMembers(groupId, userIds)` through `callApi` and the contract's `groups.addMembers` (`{ userIds }`), next to `removeGroupMember`.
- **`apps/web/src/store/effects/groupSettings.ts`**: added the two store effects `addGroupMembers(ctx, chatId, userIds)` and `removeGroupMember(ctx, chatId, userId)`, both through `changeGroupCore` with `refresh: true` (repaint the group detail, then refresh the chat list), following `leaveChannel`/`changeChannelRole`.
- **`apps/web/src/store/effects/groupActions.ts`**: added the two names to the `GroupActions` pick and wired them in `makeGroupActions` via `rt.runPromise`.
- **`apps/web/src/store/store.ts`**: added exactly the two action type lines to `ChatStore` (394 → 396 lines, no comments, per the spec's limit).
- **`apps/web/src/components/GroupMembersSection.tsx`** (new, 249 lines): the members section that replaces the old markup:
  - member rows as before, with the T-0116 role chips (fresh roles list wins over the detail snapshot);
  - for owners/admins, a Remove button on rows that are not the owner and not yourself, with an inline confirm (the button turns destructive and a Cancel appears; no `confirm()`);
  - an "Add members" button for owners/admins opening a `Dialog` with the contacts not already in the group as checkboxes (copied from `NewGroupDialog`), then Add;
  - "Leave group" for non-owners with an inline confirm, calling `leaveChannel(chatId)` and then `onClose()` + `navigate('/')`;
  - for the owner, the muted line "Owners can't leave yet.";
  - failures show inline through `FieldError`.
- **`apps/web/src/components/GroupPanel.tsx`**: removed the members markup (and the now-unused `HandleSuffix`/`roleLabel` imports) and renders `<GroupMembersSection chatId info me rolesByUser onClose />`. 362 → 329 lines.

### Files changed
`apps/web/src/components/GroupMembersSection.tsx` (new), `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/lib/api/groups.ts`, `apps/web/src/store/effects/groupSettings.ts`, `apps/web/src/store/effects/groupActions.ts`, `apps/web/src/store/store.ts`, `work/T-1183-web-group-members.md`.

### Commands and results
- `pnpm install`: done, "Done in 24s" (one pre-existing peer warning: `@types/react-dom` wants `@types/react@^19.3.0`, found 19.2.18 — unrelated to this task).
- `pnpm exec prettier --write <the six code files>`: formatted the files (no other files touched).
- `pnpm gate` (from the repo root): **GATE PASS**, summary lines:
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.8s)
  PASS  lint  (1.4s)
  PASS  typecheck  (6.9s)
  PASS  effect  (1.6s)
  PASS  tests @zilar/web  (9.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
- No extra tests were run (the spec says no tests: UI change, server rules unchanged).

### Deviations from the spec
1. **Deep imports instead of the barrels.** `apps/web/src/lib/api.ts` (the API barrel) and `apps/web/src/store/effects/groups.ts` (the effects barrel) are not in Allowed files, so I did not add the new names there. `groupSettings.ts` imports `addGroupMembers` from `@/lib/api/groups` directly, and `groupActions.ts` imports the two effects from `./groupSettings` directly. Same behaviour, but the barrels do not re-export the two new names.
2. **`addGroupMembers` does not go through the `ApiClient` port.** `apps/web/src/store/effects/ports.ts` (the port type and `realApi`) is not in Allowed files, so the new effect calls the `@/lib/api/groups` function directly; `removeGroupMember` uses the existing port. Consequence: the store's add action is not fake-able through the injected test ports. No test exercises it.
3. **"Add members" button is hidden when there is nothing to add** (no contacts, or every contact already a member), so the empty dialog never opens. Otherwise the button appears for owners/admins as specified.
4. **Inline confirm shape.** For both Remove and Leave I used one button that switches to the `destructive` variant and a separate Cancel (matching `GroupRolesSection`'s inline confirms), rather than a two-button confirm row.

### Open questions
None.

### Line counts
All touched files are ≤ 400 (the gate's `max-lines`); `GroupMembersSection.tsx` is 249, within the spec's ≤ 250.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 follow-ups.**
- **The new `GroupMembersSection`** (249 lines):
  - member rows with role chips;
  - Remove with an inline confirm, for owners and admins, on rows that aren't the owner or yourself;
  - Add members, a contact checklist dialog that leaves out existing members;
  - Leave group with an inline confirm for non-owners, which navigates to `/`;
  - an "Owners can't leave yet" line for the owner.
- **New calls:** `addGroupMembers` in the API, and store actions that refresh the detail and the list.
- **Sizes:** `GroupPanel.tsx` went from 362 to 329 lines, and `store.ts` is 396.
- **Follow-ups:**
  1. route `addGroupMembers` through the ApiClient port;
  2. re-export it through the barrels.
- **Still to do:** the live check with test accounts.

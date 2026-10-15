---
id: T-1569
title: "Phone Group info T2 (plan docs/audit/phone-group-info-plan.md §6): Members page (search, Add members, Invite with a link, owner/admin icons, ⋮ Make owner / Remove, Roles row) and AIs page (list, Add my AI, Remove) as full-screen pages of the Group info screen; new store actions for add members / add-remove AI / remove member; the AIs row on the root; T1 nits (Leave text, Mute/Search before chats load)"
status: merged
milestone: M5
branch: task/T-1569-mobile-group-info-people
model: auto
effort: default
depends_on: []
estimate: 60 min
---

# T-1569: Phone Group info — Members and AIs pages

## Spec (written by Claude, do not edit)

### Why
This is step T2 of `docs/audit/phone-group-info-plan.md` §6 (read it, along with the lead's answers in `work/T-1542-*.md` › Review). The boards are `docs/design/mockups/group-info/README.md` and `Phone.dc.html`.

T1 (T-1552) built the root page. Its Members row still opens the old roles sheet, and the root has no AIs row.

**The page rules (README:42-49):**
- no section headings and no hint paragraphs;
- a status is an icon, never a word;
- counts come from loaded data.

### Facts (the lead read them on main after T-1552, 2026-10-15)
- **`apps/mobile/src/app/group-info/[id].tsx` (238 lines):** the screen.
  - `groupChatId = general?.id ?? topics[0]?.id ?? groupId` (`:59`);
  - `members` (`:61`) and `groupAis` (`:62`) from `groupDetail`;
  - `roles = useGroupRoles(groupId, members)` (`:68`) and `openLinks` (`:82`);
  - the root gets `onOpenMembers={roles.open}` (`:107`) and `onAdd={openLinks}`;
  - the Leave confirm text is at `:138` ("… You can be added back later.");
  - `InviteLinksSheet` (`:182`) and `GroupRolesSheet` (`:196`).
- **`apps/mobile/src/components/group-info/root-page.tsx` (107):** a People `InfoRowGroup` holds Members (`peopleCount`) and Invite links (managers) (`:87-90`), then Settings (owner) and Leave (non-owner). `info-row.tsx` (84) has `InfoRow` and `InfoRowGroup`.
- **The other copy of the Leave text:** `apps/mobile/src/components/chat/group-manage-section.tsx:289`, "Leave {groupTitle}? You can rejoin only with an invite."
- **`apps/mobile/src/lib/groups-api.ts` (135):**
  - has `removeGroupMember` (`:52`), `changeGroupMemberRole` (`:46`) and `transferGroupOwner` (`:57`);
  - **no** `addMembers`, `addAi` or `removeAi`.
  - The contract (`packages/api-contract/src/groups.ts:197-214`) has `addMembers` (POST `/groups/:id/members`, `{ userIds }`), `removeMember`, `addAi` (POST `/groups/:id/ais`, `{ aiId }`) and `removeAi` (DELETE `/groups/:id/ais/:aiId`); each returns `GroupDetail`.
- **The store:**
  - `apps/mobile/src/store/effects/group-actions.ts` is 393 lines: **do not grow it**.
  - Its pattern (`transferGroupOwner`, `:261-268`) is `ctx.run(Effect.gen(… lift(() => groupsApi.X(…)); yield* ensureGroupDetail(groupId, true); yield* refreshQuietly))`.
  - `apps/mobile/src/store/effects/groups.ts` (283) builds `makeGroupActions(ctx, { … ensureGroupDetail, refreshQuietly, … })` (`:267-280`) and lists the action names in a union (`:30-50`).
  - `apps/mobile/src/store/types-groups.ts` (215) has the signatures (for example `transferGroupOwner`, `:145`) and `ownedAis` (`:71`).
- **A people picker exists:** `NewGroupMembers({ contacts, selected, onToggle })` (`apps/mobile/src/components/group/new-group-members.tsx:34`), used by `apps/mobile/src/app/group/new.tsx` with `contacts` from the store and `toggleSelected`.
- **Web reference:**
  - `apps/web/src/components/GroupMembersSection.tsx` (search; Add members and Invite with a link for managers);
  - `apps/web/src/components/group-info/MemberRow.tsx`: owner `Crown` (#e5b84b) and admin `Shield` as icons (`:69-78`); role tags; ⋮ Make owner / Remove; removable when `isManager && member.role !== 'owner' && member.userId !== me` (`:43`);
  - `apps/web/src/components/panels/GroupAiSection.tsx`: Add for managers (`:61`); remove when `ai.ownerId === me || isManager` (`apps/web/src/components/GroupPanel.tsx:238`).

### Steps
1. **Store** (new `apps/mobile/src/store/effects/group-membership-actions.ts`):
   - `makeGroupMembershipActions(ctx, { ensureGroupDetail, refreshQuietly })` returns `addGroupMembers(groupId, userIds)`, `removeGroupMember(groupId, userId)` (someone else), `addGroupAi(groupId, aiId)` and `removeGroupAi(groupId, aiId)`, each in the `transferGroupOwner` pattern;
   - add the three missing wrappers to `groups-api.ts`;
   - add the signatures to `types-groups.ts`;
   - in `groups.ts`, compose the actions into `actions` and add the names to the union.
2. **Pages:** the screen gets `page: 'root' | 'members' | 'ais'` state. Each page is full screen with the root's back key, which returns to the root, and a 28 px title.
   - **The root:** Members opens the members page. A new **AIs** row (`Bot` icon, count `groupAis.length` once the detail is loaded) sits after Members in the People group.
   - **The Add key:** opens the members page with the Add picker open (managers). Hide Add for non-managers.
3. **`members-page.tsx`** (new, `apps/mobile/src/components/group-info/`):
   - a search field;
   - **for managers:** an "Add members" row, which opens a `BottomSheet` with `NewGroupMembers` over contacts not already members, plus an Add button that calls `addGroupMembers`; and an "Invite with a link" row, which opens the existing `InviteLinksSheet`;
   - one rounded list of members: avatar, name and `@handle`; `Crown` or `Shield` icons for owner and admin; role tags as small chips;
   - a ⋮ key when removable (web's rule), opening an `ActionSheet`: **Make owner** (owner only, with the existing confirm flow) and **Remove** (destructive);
   - **for managers,** a last "Roles" row opens the existing `GroupRolesSheet`.
4. **`ais-page.tsx`** (new): the group's AIs (orb `EntityAvatar` and name).
   - **⋮ Remove** when `ai.ownerId === me || isManager`.
   - **For managers,** an "Add AI" row opens an `ActionSheet` of the viewer's `ownedAis` not already in the group.
5. **T1 nits:**
   - the Leave confirm (`[id].tsx:138`) uses the same sentence as `group-manage-section.tsx:289` ("You can rejoin only with an invite.");
   - Mute and Search are disabled until `general` (the group's chat) is loaded, instead of falling back to the raw `groupId`.
6. **Every file stays under 400 lines.** If `[id].tsx` would pass 400, move the sheets into a small `group-info-sheets.tsx`.

### Not in scope
- Content pages (T3);
- Settings (T4);
- channels (T5/T6);
- web;
- the server.

### Tests
None (UI and store glue; the server enforces permissions).

### Allowed files
- `apps/mobile/src/app/group-info/[id].tsx`
- `apps/mobile/src/components/group-info/root-page.tsx`
- `apps/mobile/src/components/group-info/members-page.tsx` (new)
- `apps/mobile/src/components/group-info/ais-page.tsx` (new)
- `apps/mobile/src/components/group-info/group-info-sheets.tsx` (new, only if needed)
- `apps/mobile/src/lib/groups-api.ts`
- `apps/mobile/src/store/types-groups.ts`
- `apps/mobile/src/store/effects/groups.ts`
- `apps/mobile/src/store/effects/group-membership-actions.ts` (new)
- `packages/mock-backend/src/domains/groups/members-routes.ts` (only if the mock lacks the add-member/AI routes; say so in the Report)
- `packages/mock-backend/src/domains/groups/routes.ts` (same condition)
- `work/T-1569-mobile-group-info-people.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- **Phone mock `/group-info/g-devteam`:** the People group shows Members `4`, AIs `2` and Invite links.
- **The pages are read in the code** (the smoke can't tap): the members page lists the 4 people with owner and admin icons; the AIs page lists Dev-1 and QA-1.
- The Report gives the `wc -l` of every changed file.

---

## Report (written by the worker when done)

### What I did

**Store (T2 glue).** New `apps/mobile/src/store/effects/group-membership-actions.ts`:
`makeGroupMembershipActions(ctx, { ensureGroupDetail, refreshQuietly })` returns
`addGroupMembers`, `removeGroupMember`, `addGroupAi`, `removeGroupAi`, each in the
`transferGroupOwner` pattern (call the route, reload the detail, refresh the chat list
best-effort). Three wrappers added to `groups-api.ts` (`client.groups.addMembers`,
`.addAi`, `.removeAi`; the answered detail is dropped, the store reloads it), four
signatures added to `types-groups.ts`, and `groups.ts` composes the new actions into
`actions` — typed `GroupActions & GroupMembershipActions` so `makeGroupActions` (which
must not grow) keeps its own return type.

**Pages.** `[id].tsx` now holds a `page: 'root' | 'members' | 'ais'` state and renders the
chosen page beside all the existing sheets, so the Members page's Invite-links and Roles
rows reuse them. `root-page.tsx` gains the AIs row (`Bot`, count `groupAis.length`) after
Members in the People group and an `onOpenAis` prop. New `members-page.tsx`: search, Add
members (BottomSheet + `NewGroupMembers` over contacts not already members + Add button),
Invite with a link, one rounded member list (avatar, name and `@handle`, Crown/Shield
icons, role chips), a ⋮ per removable row (`Make owner` owner-only, `Remove` destructive,
each behind a confirm) and a Roles row for managers. New `ais-page.tsx`: the group AIs as
orb rows with a ⋮ Remove (`ai.ownerId === me || isManager`) and an Add AI row for managers
(`ActionSheet` of `ownedAis` not already in the group). The root's Add key now opens the
Members page with the picker already open.

**T1 nits.** The Leave confirm message is now `You can rejoin only with an invite.` (title
`Leave {groupTitle}?`, the same sentence as `group-manage-section.tsx:289`). `groupChatId`
is now `general?.id ?? topics[0]?.id` with no raw `groupId` fallback; the keys are dimmed
and non-interactive until the group's own chat row is loaded.

**Mock backend:** no edit needed. `groups/routes.ts:66` already routes `/ais` to
`handleGroupAis` and `members-routes.ts:28` already answers `POST /members`; both add/remove
routes the pages use exist, so `members-routes.ts` and `routes.ts` are untouched.

### Checks run

- `pnpm gate` from the repo root (final run):

      gate: 9 changed file(s) against main
      PASS  install (frozen)  (1.4s)
      PASS  format  (1.2s)
      PASS  lint  (0.7s)
      PASS  typecheck  (3.4s)
      PASS  effect  (0.7s)
      PASS  tests @zilar/mobile  (5.5s)
      scope: every changed file is inside the Allowed files
      migration: every added migration continues from the base
      images: every workspace package an app image needs is copied into Dockerfile
      size: every changed source file is within 400 lines
      GATE PASS

- No single test files were run: the change is UI and store glue with no test near it
  (the Spec says "Tests: None"), and the mobile package has no component-render harness
  (`AGENTS.md`: UI code gets no tests).

### `wc -l` of every changed file

    apps/mobile/src/app/group-info/[id].tsx                              303
    apps/mobile/src/components/group-info/root-page.tsx                  125
    apps/mobile/src/components/group-info/members-page.tsx               355
    apps/mobile/src/components/group-info/ais-page.tsx                   198
    apps/mobile/src/lib/groups-api.ts                                    162
    apps/mobile/src/store/types-groups.ts                                238
    apps/mobile/src/store/effects/groups.ts                              290
    apps/mobile/src/store/effects/group-membership-actions.ts             56

`group-info-sheets.tsx` was not created: `[id].tsx` stayed at 303 lines, so no sheet had to
move.

### Notes for the lead

- **Disabled Mute/Search (deviation).** The keys live in `info-keys.tsx`, which is **not**
  in this task's Allowed files, and it has no `disabled` prop. To disable them within scope I
  dim (`opacity-40`) and set `pointerEvents="none"` on the whole `InfoKeys` row in
  `root-page.tsx` while the group's own chat row is not loaded. That also disables Add/More
  for that instant. The core of the nit is done (no raw `groupId` fallback; Search is a
  no-op without a chat id). Because `general` comes from the app's already-loaded chat list,
  the window is essentially never visible. Say the word and I will add a `disabled` prop to
  `info-keys.tsx` (needs it in scope) to disable only Mute and Search.
- **Add AI flow.** The AIs page follows the Members page: ⋮ → `ActionSheet` Remove →
  `ConfirmDialog`. Web removes inline with a small confirm; the phone spec says "⋮ Remove".
- **Add members picker height.** `NewGroupMembers` fills a screen with `flex-1`, which
  collapses inside the sheet's ScrollView, so the Members page wraps it in a `View` at 60% of
  the window height. If the smoke shows the picker too short, the factor is the one knob.
- **Acceptance.** The mock `g-devteam` seed has 4 people (You owner, Ana admin, Luis, Marco)
  and 2 AIs (Dev-1, QA-1), so the root People group shows Members `4`, AIs `2` and Invite
  links, the Members page lists the four with the owner/admin icons, and the AIs page lists
  Dev-1 and QA-1. This is read from the code and the seed; I could not tap the simulator.

### Round 1 (fix round)

Fix round against `PREREVIEW.md`.

**Findings fixed.**
- **Finding 1 (should-fix): failed Add showed no error behind the open sheet.**
  - `apps/mobile/src/components/group-info/members-page.tsx`: the `BottomSheet` footer now
    renders the fixed-sentence add error (`failure?.kind === 'add' ? error : ''`) above the
    Add button, so it is visible while the picker stays open.
  - `apps/mobile/src/components/group-info/ais-page.tsx`: the "Add AI" `ActionSheet` now gets
    `error={failure?.kind === 'add' ? error : ''}`, which the sheet already renders under its
    items (the `ActionSheet` `error` prop).
- **Finding 2 (nit, union list)** and **Finding 3 (nit, Leave row before chats load)** were
  left as they are: this round only fixes must-fix and should-fix findings, and neither line
  is touched by the finding-1 change.

**Tests added.** None. The fix is pure UI JSX; the Spec says "Tests: None", the mobile
package has no component-render harness, and `AGENTS.md` ("Tests") says UI code gets no
tests. The finding names no test.

**Checks.**
- No single test files were run (no test file touched).
- `pnpm gate` from the repo root:

      gate: 9 changed file(s) against main
      PASS  install (frozen)  (1.2s)
      PASS  format  (1.4s)
      PASS  lint  (0.8s)
      PASS  typecheck  (3.2s)
      PASS  effect  (0.7s)
      PASS  tests @zilar/mobile  (4.8s)
      scope: every changed file is inside the Allowed files
      migration: every added migration continues from the base
      images: every workspace package an app image needs is copied into Dockerfile
      size: every changed source file is within 400 lines
      GATE PASS

`wc -l` after the fix: `members-page.tsx` 362, `ais-page.tsx` 199 (both under 400).

**Disagreements.** None: findings 2 and 3 are nits and are knowingly left unchanged, per
this round's scope.

## Review (written by Claude)

**Approved and merged.**

- **Pre-review:** clean after one autopilot round, with 2 nits and 1 follow-up.
- **Phone smoke** (`/group-info/g-devteam`, mock): PASS. The People group reads Members `4`, AIs `2` (Bot icon) and Invite links, then Settings.
- **Read in the code** (the smoke can't tap):
  - **The members page:** search; Add members and Invite with a link for managers; the owner shows `Crown` and admins `Shield`; ⋮ appears only when `isManager && role !== 'owner' && not me`, the same rule as web; a Roles row comes last.
  - **The AIs page:** remove when the viewer owns the AI or is a manager; Add AI lists the viewer's own AIs that are not in the group yet.
  - **The store:** the new actions call the API, reload the detail with `ensureGroupDetail(groupId, true)` and refresh quietly, the same as `transferGroupOwner`.
- **Sizes:** every file is under 400 lines (`members-page.tsx` 362, the screen 303).
- **T1 nits:** the Leave text now matches the manage section.
- **Left for later:**
  - while chats load, `info-keys.tsx` dims the whole key row, not only Mute and Search;
  - `useGroupManage` still falls back to the raw group id before chats load.


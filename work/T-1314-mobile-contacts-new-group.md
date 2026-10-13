---
id: T-1314
title: "Mobile Telegram-style people screens: the Contacts list shows status and opens the chat (Remove moves to the profile), with search; New group becomes a full-screen picker with search, selected chips and a name/photo step"
status: merged
milestone: M5
branch: task/T-1314-mobile-contacts-new-group
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1314: Contacts list and New group, Telegram-style (mobile)

## Spec (written by Claude, do not edit)

### Why
Julio wants the phone app "more like Telegram" (2026-10-13). Lead's QA on the release APK (`f9b833c`) the same night:
- **Contacts** (`apps/mobile/src/app/settings/contacts.tsx`, 292 lines): each row is avatar, "Julio @julio" and a **Remove** button. There's no online / last-seen status, no search, and tapping the row does nothing obvious. In Telegram a contact row shows the name and "last seen …" or "online", tapping opens the chat, and removing lives on the profile.
- **New group** (`apps/mobile/src/components/chat/new-group-sheet.tsx`, 288 lines, opened from `apps/mobile/src/components/chat/new-chat-button.tsx`): a small centred dialog, "Add members", with a plain list, a check on tap, and Cancel / Next. It has no search, and selected people aren't shown as chips. With many contacts it's cramped.

### What to build
1. **Contacts list:**
   - each row is avatar, name, and a second line with the status ("online" or "last seen …", from the same presence source the chat header uses; cite it) or @handle when no status is known;
   - tapping the row opens the DM, using the same helper as the profile's Message button (`resolveDmChatId`, T-1288; cite it);
   - long-press, or a trailing "⋯" icon button, offers "View profile" and "Remove contact" (with today's confirm);
   - a search field at the top filters by name and handle;
   - sorted with online contacts first, then by name.
   - Keep the requests or "add contact" entry if the screen has one.
2. **New group, as a full-screen route** (e.g. `apps/mobile/src/app/group/new.tsx`; check `apps/mobile/src/app/group/` first):
   - **step 1:** a search field, the contact list with round checkboxes, and selected people shown as removable chips above the list; "Next" sits in the header;
   - **step 2:** the group name (required), an optional photo (reuse the existing group-photo picker if there is one; cite it), the member count, and "Create".
   - Reuse the existing create-group call from `new-group-sheet.tsx` unchanged.
   - The "+" menu's New group opens this route.
   - Delete the old dialog if nothing else uses it.
3. **Every file at most 400 lines;** split into components under `apps/mobile/src/components/contacts/` and `apps/mobile/src/components/group/` as needed. Icons only (lucide), no emoji. **No tests** (UI).

### Read first
`AGENTS.md`, the two files above, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/contacts/` (list it), `apps/mobile/src/app/group/` (list it), and `apps/mobile/src/components/chat/chat-header.tsx` (presence text).

### Allowed files
`apps/mobile/src/app/settings/contacts.tsx`, `apps/mobile/src/app/group/*.tsx`, `apps/mobile/src/components/chat/new-group-sheet.tsx`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `apps/mobile/src/components/contacts/**/*.tsx`, `apps/mobile/src/components/contacts/**/*.ts`, `apps/mobile/src/components/group/**/*.tsx`, `apps/mobile/src/components/group/**/*.ts`, `packages/mock-backend/src/domains/groups/*.ts`, `packages/mock-backend/src/domains/directory/groups.ts`, `work/T-1314-mobile-contacts-new-group.md`. (Lead, 2026-10-13: the mock-backend paths were added for fix round 2.)

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The lead's check on the emulator mock:**
  - Contacts shows statuses and search, and a tap opens the chat;
  - "+" → New group opens the full-screen picker, and selecting two people shows chips;
  - Next shows the name step, and Create makes the group.

---

## Report (written by the worker when done)

### What I did

**Contacts list (`apps/mobile/src/app/settings/contacts.tsx`)**
- Each row is now avatar + name + a second line: the status from the same source
  the chat header uses (`apps/mobile/src/components/chat/chat-header.tsx` renders
  `chatSubtitle` over the chat store's DM rows), or `@handle` when no status is
  known. The presence is read by `contact-presence.ts` from the store's `chats`
  (`ChatSummary.online` / `lastSeenAt`, the fields the XMPP presence handler
  writes).
- Tapping the row opens the DM via `resolveDmChatId`
  (`apps/mobile/src/components/chat/dm-chat-id.ts`, T-1288), the same helper the
  profile's Message button uses (`apps/mobile/src/app/u/[handle].tsx:222`); when
  the chat is not in the list yet it calls the store's `reloadChats()`.
- Each row has a trailing `⋯` (lucide `MoreVertical`) and long-press, both
  opening an ActionSheet with **View profile** (only when the contact has a
  handle; pushes `/u/[handle]`) and **Remove contact**. Remove keeps today's
  confirm sentence and the existing T-1233 `performRemoveContact` call.
- A `SearchField` above the list filters by name and handle.
- Sorted online-first, then by name (`sortContactsByPresence`).

**New group as a full-screen route (`apps/mobile/src/app/group/new.tsx`)**
- Step 1 (`new-group-members.tsx`): search field, selected people as removable
  chips above the list, and the contact list with round checkboxes.
- Step 2 (`new-group-name.tsx`): required group name, the picked members (avatars
  + count), and Create. Reuses the same `createGroup` store call and the same
  `buildGroupCreateInput` / `createErrorText` guards the old sheet used.
- "Next" and "Create" live in the header.
- The `+` menu's **New group** now pushes `/group/new`; the old
  `new-group-sheet.tsx` was deleted (nothing else imported it).

### Files changed
- `apps/mobile/src/app/settings/contacts.tsx` (rewritten)
- `apps/mobile/src/components/chat/new-chat-button.tsx` (New group opens the route; group dialog removed)
- `apps/mobile/src/components/chat/new-group-sheet.tsx` (deleted)
- `apps/mobile/src/app/group/new.tsx` (new)
- `apps/mobile/src/components/contacts/contact-presence.ts` (new, pure helpers)
- `apps/mobile/src/components/contacts/contact-row.tsx` (new)
- `apps/mobile/src/components/contacts/contact-list.tsx` (new)
- `apps/mobile/src/components/contacts/contact-chip.tsx` (new)
- `apps/mobile/src/components/group/new-group-members.tsx` (new)
- `apps/mobile/src/components/group/new-group-name.tsx` (new)
- `work/T-1314-mobile-contacts-new-group.md` (status + this report)

### Commands run
- `pnpm install` — done, 1271 resolved, 1181 packages added.
- `pnpm gate` (first run) — `FAIL lint`, one error in my new file
  (`contact-list.tsx:74 react(set-state-in-effect)`); everything else passed.
  Fixed by closing the remove confirm during render (the `profile-card.tsx`
  pattern) instead of in an effect.
- `pnpm gate` (final) — summary:
  ```
  gate: 11 changed file(s) against main
  PASS  install (frozen)  (2.6s)
  PASS  format  (1.8s)
  PASS  lint  (1.8s)
  PASS  typecheck  (7.0s)
  PASS  effect  (5.7s)
  PASS  tests @zilar/mobile  (7.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- I ran no standalone test file: every touched directory has no test named after
  a changed file, and the gate's test step ran the mobile suite (near test
  `components/chat/dm-chat-id.test.ts`) itself.

### Deviations / notes
- **Step 2 keeps the Private/Public visibility fields** (`VisibilityFields`), which
  the spec's step-2 list did not name. I kept them because "reuse the existing
  create-group call unchanged" includes the T-0228 public-group option; dropping
  the fields would silently remove a working feature. If the intent was
  Telegram-only (private) groups, tell me and I will remove them.
- **No group photo.** There is no group-photo picker anywhere in the app, and
  neither `CreateGroupPayload` nor the `createGroup` store call accepts a photo
  (`packages/api-contract/src/groups.ts:40`, `store/effects/group-actions.ts:217`),
  so the "optional photo" step has nothing to reuse. Skipped with nothing to cite.
- **Mock presence.** The mock backend seeds no per-contact presence, so in mock
  mode the second line shows the `@handle` fallback (exactly the spec's "or @handle
  when no status is known"); `online` / `last seen …` appear on a real server where
  presence events arrive.
- The Contacts screen has no requests / "add contact" entry of its own (requests is
  a separate `settings/requests` item), so nothing was kept there.

### Security checklist
- UI-only change: no routes, no `where` clauses, no caps, no audit, no secrets.
  The remove still goes through the existing scoped T-1233 `DELETE /contacts/:userId`
  and its fixed-sentence errors.

### Open questions
- Keep or drop the Public-group option in step 2 (see Deviations)?

---

### Fix round (2026-10-13 02:55 lead check): Create did not open the group

**Diagnosis (answers to the three questions)**

1. **`createGroup` resolves, it does not reject.** Probe against the branch's own
   mock backend:
   `POST /api/groups {title:'Night QA', memberIds:['u-ana','u-marta']}` → `201`,
   body id `g-mock-1`. So the name-step error path is not involved.
2. **Yes — the id is a group the group screen does not know yet, and its guard
   bounces it back.** The guard is
   `apps/mobile/src/app/group/[id].tsx:215`:
   `if (topics.length === 0 && chatsLoad === 'loaded') { goBackOrHome(router); return null; }`.
   `topics = topicsOfGroup(chats, groupId)`. The real cause of the empty list is
   the **mock backend**: its `POST /api/groups` (`packages/mock-backend/src/domains/groups/routes.ts:60`)
   stores the group in the groups table but never adds it to `data.chats` and never
   creates its General topic (the real server does —
   `apps/server/src/groups/service.ts:157-163`). Probe: after the create,
   `GET /api/chats` → 12 chats, **0** titles "Night QA"; `GET /api/groups/g-mock-1/topics`
   → `200 {"topics":[]}`. Web hides this gap by repainting the created row from the
   returned detail (`apps/web/src/store/effects/groupCreate.ts:26 repaintCreatedGroup`,
   `requireRow: true`); mobile's store relies on `/api/chats` returning the row
   (`apps/mobile/src/store/effects/group-actions.ts:234`,
   `refreshAndLocate: () => refreshQuietly.pipe(Effect.as(undefined))`).
3. **Yes — `router.replace` decides where the bounce lands.** `new.tsx` replaces
   the top of the stack (`[tabs, new] → [tabs, group/[id]]`), so the guard's
   `goBackOrHome` lands on the chat list. With `push` it would land back on the
   New group form instead (no better).

**What main's old sheet did after `createGroup` succeeded:** the same thing —
`new-chat-button.tsx` at `main` ran `createGroup(input)` then
`openGroupScreen(groupId)` → `router.push({ pathname: '/group/[id]', params: { id } })`
from the tabs-index modal. Same redirect, so this bug predates T-1314.

**Fix applied (inside Allowed files):** the New group route now lands on the group
screen marked as just created — `router.replace({ pathname: '/group/[id]',
params: { id: groupId, created: '1' } })` (`apps/mobile/src/app/group/new.tsx`).
The group screen reads the flag (`justCreated`) and lets the screen render while
the chat list catches up instead of bouncing (`apps/mobile/src/app/group/[id].tsx`,
guard comment `T-1314 fix`), and its header falls back to the group detail's title
(`groupDetail?.title`) so a just-created group shows its real name. A normal open
(the flag absent) keeps the old redirect.

**Still needs a decision — the second acceptance bullet ("the group appears in
the chat list") cannot be met from the Allowed files.** In mock, the created group
never enters `/api/chats` (probe above), so the chat list will not show it no
matter what the app does. The two real fixes are both **outside this task's Allowed
files**:
- `packages/mock-backend/src/domains/groups/routes.ts` — add the chat entry and the
  General topic on create, mirroring the real server (the file already has
  `addChat` in `domains/directory/groups.ts:151` for joins); or
- `apps/mobile/src/store/effects/group-actions.ts` — paint the created row from the
  returned detail (the mobile twin of web's `repaintCreatedGroup`).

Please tell me which to take (and expand the Allowed files), or say that the app-side
fix is enough. I left `status: review` per your instruction.

**Fix-round commands**
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json` → exit 0, no errors.
- `pnpm gate` → `GATE PASS`:
  ```
  gate: 12 changed file(s) against main
  PASS  install (frozen)  (1.3s)
  PASS  format  (1.1s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.3s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/mobile  (1.3s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- Diagnostic probe (read-only, in-memory mock; not a repo file):
  `pnpm --filter @zilar/devtools exec tsx -e "..."` → `create status 201 id g-mock-1`,
  `chats total 12 matches 0`, `group topics status 200 {"topics":[]}`.

### Fix round 2 (prereview, 2026-10-13)

**Findings fixed**
- Finding 1 (should-fix) — `apps/mobile/src/app/group/[id].tsx`: `justCreated`
  was a raw URL read (`params.created === '1'`) honoured forever, so
  `/group/<unknown-or-forbidden-id>?created=1` never bounced. It is now a
  one-shot state flag (`keepCreated`) consumed during render as soon as
  `chatsLoad === 'loaded'`; after the chat list settles the guard bounces an
  empty group like every other unknown id. A genuinely fresh group has its
  topic rows by then (the `createGroup` store call awaits the chat-list
  refresh), so the open right after Create is unaffected. The comment records
  the reason.

**Findings skipped**
- Finding 2 (nit) — `new-chat-button.tsx:95-97` stale comment: not in a line
  this round changes, left as is per instructions.
- Finding 3 (follow-up) — mock-backend create-group gap: needs
  `packages/mock-backend` / `store/effects/group-actions.ts`, both outside the
  Allowed files; left for the follow-up.

**Tests added**
- None: the finding names no test, the touched file is UI, and the spec's
  Checks are `pnpm gate` only (spec: "No tests (UI)"; AGENTS.md: UI gets no
  tests).

**Round commands**
- `pnpm gate` → see summary below.

**Gate summary**
```
gate: 12 changed file(s) against main
PASS  install (frozen)  (1.1s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (2.8s)
PASS  effect  (0.5s)
PASS  tests @zilar/mobile  (1.0s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

**Note on mock:** with the flag now spent once the chat list settles, a group
created against the mock backend (which never adds the chat row, finding 3)
bounces home instead of showing an empty screen. That is the correct unknown-id
behaviour and the mock gap is the filed follow-up.

**Disagreements**
- None.

### Fix round 3 (lead's emulator check, 2026-10-13 03:12)

**Root cause (mock) fixed**
- `packages/mock-backend/src/domains/groups/routes.ts` `createGroup` now mirrors
  the server's create transaction: it appends the caller's new group to
  `data.chats` (via `addChat`, now exported from
  `packages/mock-backend/src/domains/directory/groups.ts`) and inserts its
  General topic in the group's own room (`generalTopicRow` /
  `groupRoomJid` from `domains/chats/general-topics.ts`). Channels keep the
  channel fields (`chatKind`, `subscriberCount`, `description`); the creator's
  `/chats` role is `owner`. Reference: `apps/server/src/groups/service.ts:157-171`.

**The `created` / `justCreated` bypass is removed**
- `apps/mobile/src/app/group/new.tsx`: `router.replace('/group/[id]', { id })`
  no longer sends `created: '1'`.
- `apps/mobile/src/app/group/[id].tsx`: the `created` param, the `keepCreated`
  state and the render-time clear are gone; the guard is back to
  `topics.length === 0 && chatsLoad === 'loaded'`.
- **Not needed on the real server**: `createGroup` runs
  `createGroupChannelCore` (`packages/client-core/src/store/group-actions.ts:257-272`),
  which awaits `refreshAndLocate` (mobile `refreshChats`) before it resolves the
  group id, and the server creates the group and its General topic in one
  transaction (`apps/server/src/groups/service.ts:140-171`). So when the group
  screen mounts, `/api/chats` already carries the new group with its General
  topic and the guard finds rows. The bypass only propped up the mock gap, which
  is now fixed at its source.

**Code-reading check of the acceptance path**
- **Create opens the group screen**: `new.tsx:70-80` `submit` resolves
  `createGroup(input)` and `Effect.tap`s
  `router.replace('/group/[id]', { id })`. On the group screen
  (`app/group/[id].tsx`) `topics = topicsOfGroup(chats, groupId)` is non-empty
  (the refreshed list carries the new group's General row, `lib/topics.ts:49-51`),
  so the `chatsLoad === 'loaded'` bounce does not fire and the topics list renders.
- **The chat list (after Back) contains the group**: the same refreshed `chats`
  entry feeds `chatListModel` (`lib/chat-list.ts:36-45`), which collapses the
  group's topics to one `{ kind: 'group', groupId }` row when `groupRowFor` finds
  the General topic; `group-list-item.tsx:56` renders it.
- A real unknown/forbidden id (no `created` param at all now) bounces as before.

**Tests added**
- `packages/mock-backend/src/domains/groups/routes.test.ts` (new): `POST /groups`
  puts the created group on `/chats` with its General topic (title, `role:
  owner`, one `isGeneral` "General" row), and a created channel keeps its channel
  fields. This is the behaviour that broke the emulator check.

**Round commands**
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/groups/routes.test.ts`
  → `Test Files 1 passed (1)`, `Tests 2 passed (2)`.
- `pnpm --filter @zilar/mobile exec tsc --noEmit -p tsconfig.json` → exit 0, no errors.
- `pnpm gate` → summary:
  ```
  gate: 15 changed file(s) against main
  PASS  install (frozen)  (1.8s)
  PASS  format  (1.6s)
  PASS  lint  (1.0s)
  PASS  typecheck  (4.1s)
  PASS  effect  (1.2s)
  PASS  tests @zilar/mobile  (2.8s)
  PASS  tests @zilar/mock-backend  (3.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

**Disagreements**
- None.

### Fix round 4 (prereview, 2026-10-13)

**Findings fixed**
- Finding 1 (should-fix) — `packages/mock-backend/src/domains/groups/routes.ts`
  `createGroup`: it now reads `body.visibility` / `body.handle` and stores the
  claim instead of hard-coding `visibility: 'private'`, `handle: null`. A public
  create validates the handle with the file's existing `handleReason` (the same
  helper `patchGroup` uses): `invalid` → 400 `handle_invalid`, `reserved` →
  409 `handle_reserved`, taken → 409 `handle_taken`; a private create keeps the
  handle `null`. Because `chatEntryOf` already carries `group.visibility` /
  `group.handle` onto the `/chats` row, the public group now also reaches the
  directory (`groupRows` reads those fields). Reference:
  `apps/server/src/groups/service.ts:173-199`.

**Findings skipped (nits, per instructions)**
- Finding 2 (nit) — `apps/mobile/src/app/settings/contacts.tsx` tap on a contact
  with no DM row. Not in a line this round changes.
- Finding 3 (nit) — `apps/mobile/src/app/group/new.tsx` step-2 header count. Not
  in a line this round changes.

**Tests added / adjusted**
- `packages/mock-backend/src/domains/groups/routes.test.ts`, two tests:
  `stores a public group with its handle and lists it on /chats` (201 detail has
  `visibility: 'public'`, `handle: 'nightclub'`; the `/chats` group row carries
  both) and `rejects a public group with a taken handle and creates nothing`
  (409 on `acme`, no chat row). Both fail without the fix (the group was stored
  `private` / `handle: null`).

**Round commands**
- `pnpm --filter @zilar/mock-backend test --maxWorkers=2 --reporter=dot src/domains/groups/routes.test.ts`
  → `Test Files 1 passed (1)`, `Tests 4 passed (4)`.
- `pnpm gate` → see summary below.

**Gate summary**
```
gate: 15 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.1s)
PASS  lint  (0.7s)
PASS  typecheck  (2.2s)
PASS  effect  (0.8s)
PASS  tests @zilar/mobile  (1.1s)
PASS  tests @zilar/mock-backend  (1.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
GATE PASS
```

**Disagreements**
- None.

## Review (written by Claude)

**Lead, 2026-10-13: approved after 2 lead fix rounds and 2 auto rounds.**
- **Root cause of "Create returns to the list":** the mock backend's `POST /api/groups` never added the chat row or the General topic, unlike the server (`groups/service.ts:157-163`). It's fixed in the mock, and the `justCreated` bypass is gone.
- **Lead's check on the emulator mock:**
  - New group is full screen, with search, round checks and chips (Ana ×, Luis ×), then Next to the name step (Private/Public);
  - Create opens "NightQA" with 3 members and 1 General topic;
  - Contacts has search and a "⋯" menu, and tapping Ana opens her chat.
- **Lead's checks:** mobile tsc: 0 errors; mock-backend: 7 tests pass. `mock-backend/.../groups/routes.ts` is 433 lines (mocks are exempt).
- **Follow-ups:**
  - a new group with no messages sorts low in the list (Telegram puts it first);
  - mock contacts have no presence or handle, so Contacts rows show no second line in mock.

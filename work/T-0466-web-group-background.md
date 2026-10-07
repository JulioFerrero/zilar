---
id: T-0466
title: "Backgrounds G2 (web): paint the group background (my chat > group > my default > slate); owners/admins set it in the group panel"
status: merged
milestone: M5
branch: task/T-0466-web-group-background
model: auto
effort: low
depends_on: [T-0463, T-0464, T-0465]
estimate: 0.5 day
---

# T-0466: web group backgrounds

## Spec (written by Claude, do not edit)

### Why
This is plan `docs/audit/chat-backgrounds-plan.md` §8, decision 4 and task G. The server stores a group background that owners and admins set (T-0463), and returns it in the group detail and on `GET /api/chats` group entries (T-0465).

The web must:
- paint it with the order **my per-chat choice, then the group's, then my default, then slate**;
- let owners and admins set it from the group panel.

**Icons only, no emoji.**

### Verified facts (do not re-derive)
- **Server:**
  - `GET /api/chats` group entries and `GET` or `PATCH /api/groups/:id` details carry `background: { backgroundPreset, backgroundImageId, backgroundDim }`, all nullable;
  - `PATCH /api/groups/:id` accepts `{ background: { backgroundPreset?, backgroundImageId?, backgroundDim? } }`, where `null` clears. A member gets 403;
  - the image must belong to the actor (the caller's own `/api/backgrounds` uploads);
  - members can `GET /api/backgrounds/:id` for the group's image.
- **Web API (`apps/web/src/lib/api.ts`):**
  - `groupEntrySchema` (lines 66-93) and `groupDetailSchema` (lines 143-166) have no `background` yet;
  - `setMembersCanCreateTopics(groupId, value)` (lines 581-590) is the `PATCH /groups/:id` pattern and returns `GroupDetail`;
  - `listBackgrounds()` and `uploadBackground()` exist (T-0464).
- **Shared type:** `ChatSummary` is in `packages/chat-core/src/types.ts:134`, with `groupId?: string` at line 176.
- **Store (`apps/web/src/store/realStore.ts`):**
  - `summaryFor(entry)` (line 611) and `summaryForTopic(title, groupId, topic, channel, visibility, handle, avatarUrl)` (line 662) build chats from entries, and are called at lines 741-750;
  - `applyGroupDetail(chatId, detail, domain)` is at line 2252;
  - `setMembersCanCreateTopics` (lines 3712-3722) shows the pattern: resolve the `groupId`, call the API, then `applyGroupDetail`.
- **Paint:**
  - `effectiveBackground(pref, fallback)` is at `apps/web/src/lib/chatBackground.ts:64-73`;
  - `MessageList.tsx:44-47` calls it with the pref and `store.defaultBackground`.
- **Group panel (`apps/web/src/components/GroupPanel.tsx`):**
  - `info = store.groupInfo(chat.id)` (line 50);
  - `isManager` = owner or admin (line 53);
  - the manager-only "Topic settings" section is at lines 545-560;
  - tests are in `apps/web/src/components/GroupPanel.test.tsx`.
- **Dialog to reuse:** `apps/web/src/components/ChatBackgroundDialog.tsx` (T-0462 and T-0464) has the preset swatches and "Your images" (upload, thumbnails, dim slider).

### What to build
1. **API:**
   - add `background` (an object with the three nullable fields) as **optional** to `groupEntrySchema` and `groupDetailSchema`;
   - add `setGroupBackground(groupId, background): Promise<GroupDetail>` (a PATCH with `{ background }`).
2. **Shared type:** add an optional `groupBackground?: { backgroundPreset: string | null; backgroundImageId: string | null; backgroundDim: number | null }` to `ChatSummary`, with a one-line doc. Optional, so mobile is untouched.
3. **Store:**
   - `summaryFor` and `summaryForTopic` set `groupBackground` from `entry.background` on every chat of that group (add one parameter to `summaryForTopic`);
   - `applyGroupDetail` updates `groupBackground` on all chats of that group from `detail.background`;
   - new action `setGroupBackground(chatId, background)` follows the `setMembersCanCreateTopics` pattern. Declare it in `store.ts` and implement it in the mock store too.
4. **Paint:**
   - `effectiveBackground(pref, fallback, group?)` gives the order: pref, then group, then fallback, then slate;
   - `MessageList` passes `chat.groupBackground`.
5. **Dialog:** `ChatBackgroundDialog` gets an optional prop `groupId?: string`. When it is set:
   - the dialog is titled "Group background";
   - there is no This chat / All chats switch;
   - picks call `store.setGroupBackground(chat.id, …)` with `{ backgroundPreset, backgroundImageId: null, backgroundDim: null }` for a preset, or `{ backgroundPreset: null, backgroundImageId, backgroundDim }` for an image;
   - "Use default" becomes "No group background" and sends all nulls;
   - the selected item comes from `store.groupInfo(chat.id)?.background`.
   
   Without the prop, nothing changes.
6. **`GroupPanel.tsx`:** in the manager-only area next to "Topic settings", add a "Group background" row: a button with a lucide `Image` icon that opens `ChatBackgroundDialog` with `groupId={info.id}`.
7. **Tests:**
   - **`lib/chatBackground.test.ts`:**
     - group over default;
     - pref over group;
     - a group image with dim;
     - an empty group falls back to the default.
   - **`components/GroupPanel.test.tsx`:**
     - an admin sees "Group background", and a member does not;
     - opening it and picking `forest` calls `setGroupBackground` with the preset fields.
   - **`components/ChatBackgroundDialog.test.tsx`:**
     - group mode hides the scope switch and titles "Group background";
     - "No group background" sends nulls.
   - **`components/MessageList.test.tsx`:** a chat with `groupBackground` `wine` and no pref paints `wine`'s colours; with its own pref `gold`, it paints `gold`.

### Read first
`AGENTS.md`, `docs/audit/chat-backgrounds-plan.md` §8, `apps/web/src/lib/api.ts:60-170` and `:575-595`, `packages/chat-core/src/types.ts:130-200`, `apps/web/src/store/realStore.ts:600-760`, `:2245-2290` and `:3705-3725`, `apps/web/src/store/store.ts` (search `setMembersCanCreateTopics`), `apps/web/src/lib/chatBackground.ts`, `apps/web/src/components/MessageList.tsx:35-50`, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/GroupPanel.tsx:40-60` and `:525-570`.

### Allowed files
`apps/web/src/lib/api.ts`, `packages/chat-core/src/types.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.test.tsx`, `apps/web/src/lib/chatBackground.ts`, `apps/web/src/lib/chatBackground.test.ts`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/MessageList.test.tsx`, `apps/web/src/components/ChatBackgroundDialog.tsx`, `apps/web/src/components/ChatBackgroundDialog.test.tsx`, `apps/web/src/components/GroupPanel.tsx`, `apps/web/src/components/GroupPanel.test.tsx`, `apps/web/src/store/reload.test.tsx`, `apps/web/src/store/realStore.forward.test.tsx`, `apps/web/src/store/realStore.media.test.tsx`, `apps/web/src/store/realStore.topics.test.tsx`, `apps/web/src/mock/api.ts`, `work/T-0466-web-group-background.md`.

Touch the four `realStore.*`/`reload` test fakes and `mock/api.ts` only where a new method needs it. If any other test breaks (including a mobile test, since `chat-core` is shared), stop and report BLOCKED with the file name.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot chatBackground MessageList ChatBackgroundDialog GroupPanel realStore
pnpm gate
```

### Acceptance
- Group chats paint the group background unless the viewer set their own per-chat one; the viewer's default and slate are the fallbacks.
- Owners and admins set or clear it (a preset, or their own image with a dim) from the group panel. Members don't see the control.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did

Implemented the web side of group backgrounds as specified.

1. **API (`apps/web/src/lib/api.ts`)**: added `groupBackgroundSchema` (three
   nullable fields) and its `GroupBackground` type; added `background` as an
   optional field to `groupEntrySchema` and `groupDetailSchema`; added
   `setGroupBackground(groupId, background)` (PATCH `/groups/:id` with
   `{ background }`).
2. **Shared type (`packages/chat-core/src/types.ts`)**: added optional
   `groupBackground` to `ChatSummary` with a one-line doc. Mobile is untouched.
3. **Store**:
   - `realStore.ts`: `summaryFor` sets `groupBackground` from `entry.background`
     on group rows; `summaryForTopic` takes a new final `groupBackground?`
     parameter and `summariesFor` passes `entry.background`; `applyGroupDetail`
     now also patches `groupBackground` onto every chat of that group from
     `detail.background` (only when the field is present, so older servers do
     not clear it); new action `setGroupBackground(chatId, background)` follows
     the `setMembersCanCreateTopics` pattern (resolve group, PATCH, apply detail).
   - `store.ts`: declared `setGroupBackground` in the store interface and
     implemented it in the mock store (updates `groupInfos` and every chat of
     the group), following the same pattern.
   - `mock/api.ts`: the mock `PATCH /groups/:id` now accepts `{ background }`
     and stores it on the mock detail.
4. **Paint (`apps/web/src/lib/chatBackground.ts`)**: `effectiveBackground` has a
   new third `group?` argument; order is pref, group, fallback, slate.
   `MessageList.tsx` passes `chat.groupBackground`.
5. **Dialog (`ChatBackgroundDialog.tsx`)**: new optional `groupId` prop. In group
   mode the title is "Group background", the This chat / All chats switch is not
   rendered, picks call `store.setGroupBackground(chat.id, …)` (preset clears the
   image fields, image sets preset null + dim), "Use default" becomes "No group
   background" and sends all nulls, and the selection is read from
   `store.groupInfo(chat.id)?.background`. Without the prop behaviour is
   unchanged.
6. **`GroupPanel.tsx`**: manager-only "Group background" button with a lucide
   `Image` icon next to "Topic settings"; opens `ChatBackgroundDialog` with
   `groupId={info.id}`.

### Tests added

- `lib/chatBackground.test.ts`: group over default, pref over group, group image
  with dim, empty group falls back to default.
- `components/MessageList.test.tsx`: group `wine` paints with no own pref; own
  `gold` pref wins.
- `components/ChatBackgroundDialog.test.tsx`: group mode hides the scope switch
  and titles "Group background"; "No group background" sends all nulls; a preset
  pick sends the preset fields.
- `components/GroupPanel.test.tsx`: owner/admin sees the control, member does
  not, and picking `forest` calls `setGroupBackground('c-devteam', { preset,
  null, null })`.
- Added `setGroupBackground` to the five existing `realStore.*`/`reload` fake
  API objects (compile-only change).

### Files changed

All 19 changed files are inside the Allowed files list: `apps/web/src/lib/api.ts`,
`packages/chat-core/src/types.ts`, `apps/web/src/store/store.ts`,
`apps/web/src/store/realStore.ts`, the four `realStore.*` test fakes +
`reload.test.tsx`, `apps/web/src/lib/chatBackground.ts` +
`chatBackground.test.ts`, `MessageList.tsx` + `.test.tsx`,
`ChatBackgroundDialog.tsx` + `.test.tsx`, `GroupPanel.tsx` + `.test.tsx`,
`apps/web/src/mock/api.ts`, and this task file.

### Commands and real results

- `pnpm install` — Done in 20.1s (pre-existing peer-dependency warning, unrelated).
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot chatBackground ChatBackgroundDialog GroupPanel MessageList`
  — 4 files passed, 80 tests passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot realStore reload`
  — 5 files passed, 171 tests passed.
- `pnpm gate` (from repo root):
  ```
  gate: 19 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (18.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (11.2s)
  PASS  tests @zilar/chat-core  (1.0s)
  PASS  tests @zilar/web  (51.2s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations

- None. No dependencies added; no files outside the Allowed list were touched.
- The web only renders and writes through `PATCH /groups/:id`; permission
  enforcement (member 403, image ownership) is server-side (T-0463/T-0465). The
  UI hides the control from non-managers and the member test confirms it.

### Open questions

- None.

## Review (written by Claude)

Approved (lead, 2026-10-07). effectiveBackground gives pref, then group, then default, then slate. ChatSummary.groupBackground (optional, chat-core) is set from list entries and from applyGroupDetail. setGroupBackground PATCHes /groups/:id. ChatBackgroundDialog has a group mode ("Group background", no scope switch, "No group background"), opened from a manager-only GroupPanel row. Pre-review clean.

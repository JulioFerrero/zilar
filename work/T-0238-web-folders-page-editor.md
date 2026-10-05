---
id: T-0238
title: "Web: Chat folders page (/settings/folders) with reorder and the folder editor dialog"
status: merged
milestone: M5
branch: task/T-0238-web-folders-page-editor
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0237]
estimate: 0.7 day
---

# T-0238: Web chat folders, part 2 (page and editor)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: folders must be fully editable like Telegram. Part 1 (T-0237) shows server folders as chips and a left rail. This task adds the place to create, edit, reorder and delete them. Brief `docs/design/briefs/telegram-nav-folders-settings.md` section b and "Decisions" 4: the Chat folders page is one centered column, and the editor opens in a dialog with the sections Name and icon, Show these chats, and Hide, with Delete kept apart from Save. Mockup: `docs/design/briefs/telegram-nav-folders-settings.html` (v3, desktop settings frame and dialog frame).

### Verified facts (do not re-derive)
- API client (T-0237), `apps/web/src/lib/api.ts`: `CreateChatFolderInput` (line 827), `PatchChatFolderInput` (line 837), `listChatFolders` (line 839), `createChatFolder` (line 843), `patchChatFolder` (line 851), `reorderChatFolders` (line 859), `deleteChatFolder` (line 867). Server errors: 409 `folder_limit` ("You can have up to 20 folders."), 404 `not_found`, 400 `invalid_request`, 429 `rate_limited`.
- Store: `folders`, `setFolders`, `activeFolder`, `setActiveFolder` on both stores (`apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`). After every successful write, call `setFolders` with the server's answer (or the refetched list) so the rail and chips update at once.
- Shared pieces: `packages/chat-core/src/folders.ts` (`FOLDER_ICONS`, `FOLDER_NAME_MAX = 24`, `FOLDERS_MAX = 20`, `FOLDER_CHATS_MAX = 100`, `chatFolderType`, `folderMatches`); icon map `apps/web/src/components/folderIcon.tsx`.
- Page pattern: `apps/web/src/routes/BlockedPage.tsx` (uses `SettingsShell` and `SETTINGS_COLUMN` from `apps/web/src/components/SettingsShell.tsx`). Route pattern: `apps/web/src/routes/AppRoutes.tsx` lines 194-200 (`/settings/blocked` in `RequireAuth`) and `BlockedRoute` at lines 246-249. Menu item pattern: `apps/web/src/components/ChatList.tsx` lines 175-185 ("Blocked people").
- Dialog pattern with focus trap and Escape: `apps/web/src/components/ConfirmDialog.tsx` (use it for the delete confirm).
- Rail: `apps/web/src/components/FolderRail.tsx`. Its folder buttons use `role="tab"` (line 86) inside a `nav` with no `tablist` (pre-review nit). The foot keys are at lines 116 and 129.
- There is no drag-and-drop library in `apps/web/package.json`. Do not add one.

### What to build
1. **Page** `apps/web/src/routes/FoldersPage.tsx` (new), route `/settings/folders` in `AppRoutes.tsx` (same pattern as Blocked), and a "Chat folders" menu item in `ChatList.tsx` next to "Blocked people".
   - Layout: `SettingsShell` (title "Chat folders", subtitle "Group chats into folders. They show in the left rail and above the chat list.").
   - One card lists the folders in order. Each row has a grip handle, the icon (`key-icon`), the name, a one-line summary (for example "Personal chats, 3 chats", built from `includeTypes` and the count of `includeChats`) and an edit pencil.
   - Under the list: "Create new folder" (hidden at 20 folders, with a muted note "You can have up to 20 folders.").
   - "All chats" is not a row: it always exists.
2. **Reorder** with native HTML5 drag (`draggable`, `onDragStart`/`onDragOver`/`onDrop` on rows) plus keyboard: the grip is a button, and Alt+ArrowUp/Alt+ArrowDown moves the row. Each move calls `reorderChatFolders(ids)`. On failure, put the old order back and show the error sentence.
3. **Editor dialog** `apps/web/src/components/FolderEditorDialog.tsx` (new), opened from a row's pencil (edit) or from "Create new folder" (create). `role="dialog"`, `aria-modal`, focus trap and Escape like `ConfirmDialog`. Sections:
   - **Name and icon:** a text field (trimmed, 1-24 characters, with a counter) and a 6-column grid of the 24 icons (radio group, the selected one uses `key-icon`, plus `aria-label` per icon name).
   - **Show these chats:** switches for Personal chats (`dm`), Groups, Channels and AIs. Then "Add chats": a searchable list of my chats (not topics, not archived) with checkboxes, max 100.
   - **Hide:** switches for "Muted chats" (`excludeMuted`) and "Read chats" (`excludeRead`), plus "Exclude chats" with the same picker, max 100.
   - Footer: Save (`key-primary`, disabled while the name is empty or nothing is included) and Cancel. In edit mode, a separate danger "Delete folder" on the left opens `ConfirmDialog` ("Delete the folder {name}? Chats stay where they are.").
   - Errors use fixed sentences: `folder_limit` → the server message; `rate_limited` → "Too many changes. Wait a moment."; anything else → "Could not save the folder. Try again."
   - After a delete, if the deleted folder was active, the store already falls back to All chats (via `setFolders`).
4. **Rail:**
   - Fix the nit: make the folder list a `role="tablist"` with `aria-orientation="vertical"` inside the `nav` (the foot keys stay outside it).
   - Add a "New" key under the folders that opens the editor in create mode. Hide it at 20 folders.
   - Add an "Edit folders" item (right-click or the context menu on a folder is NOT needed): a small pencil key at the foot above My AIs that navigates to `/settings/folders`.
5. **Tests:**
   - `apps/web/src/routes/FoldersPage.test.tsx` (new): lists folders in order with summaries; keyboard reorder calls `reorderChatFolders` with the new ids and rolls back on error; Create hidden at 20.
   - `apps/web/src/components/FolderEditorDialog.test.tsx` (new): create sends the right body; Save disabled with an empty name or nothing included; the name counter caps at 24; icon pick; include/exclude pickers cap at 100; delete confirm calls `deleteChatFolder` and closes; `folder_limit` sentence.
   - `FolderRail.test.tsx` (updated): tablist role, New opens the editor, the pencil navigates.
   - `ChatList.test.tsx`: the menu item navigates.

### Read first
`AGENTS.md`, `docs/design/briefs/telegram-nav-folders-settings.md` (sections b and Decisions), `apps/web/src/lib/api.ts` (lines 800-875), `apps/web/src/components/FolderRail.tsx`, `apps/web/src/routes/BlockedPage.tsx`, `apps/web/src/components/SettingsShell.tsx`, `apps/web/src/components/ConfirmDialog.tsx`, `packages/chat-core/src/folders.ts`.

### Allowed files
`apps/web/src/routes/FoldersPage.tsx` (new), `apps/web/src/routes/FoldersPage.test.tsx` (new), `apps/web/src/components/FolderEditorDialog.tsx` (new), `apps/web/src/components/FolderEditorDialog.test.tsx` (new), `apps/web/src/components/FolderRail.tsx`, `apps/web/src/components/FolderRail.test.tsx`, `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/mock/**`, `work/T-0238-web-folders-page-editor.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/FoldersPage.test.tsx src/components/FolderEditorDialog.test.tsx src/components/FolderRail.test.tsx src/components/ChatList.test.tsx
pnpm gate
```

### Acceptance
- From the rail or the menu I can create, rename, re-icon, change rules, reorder and delete folders. The rail and chips update without a reload.
- Limits match the server (24 chars, 20 folders, 100 chats). Every error is a fixed sentence.
- The look follows mockup v3 and the D24 recipes; icons only, no emoji. No new dependency. `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Mobile, chip long-press or context menus, swipe between folders, realtime folder events, the Settings hub redesign.

---

## Report (written by the worker when done)

Built the Chat folders settings page and the folder editor dialog.

What I did:
- New `apps/web/src/routes/FoldersPage.tsx`: `SettingsShell` page listing folders in order with grip handle, `key-icon` icon, name, summary ("Personal chats, 3 chats"), and edit pencil. Reorder via HTML5 drag (`draggable` rows) plus Alt+ArrowUp/Down on the grip button; each move calls `reorderChatFolders(ids)` and rolls back to the previous order with a fixed error sentence on failure. "Create new folder" hidden at 20 with the "You can have up to 20 folders." note. No "All chats" row.
- New `apps/web/src/components/FolderEditorDialog.tsx`: `role="dialog"` + `aria-modal` with focus trap, Escape, and focus restore (same pattern as `ConfirmDialog`). Sections: Name+icon (trimmed 1-24, counter `maxLength`-capped, 6-column grid of all 24 `FOLDER_ICONS` as a radiogroup with selected `key-icon` and per-icon `aria-label`), Show these chats (4 type switches + searchable checkbox picker of my non-topic, non-archived chats, max 100), Hide (`excludeMuted`/`excludeRead` switches + Exclude picker, max 100). Footer: Save (`key-primary`, disabled while name empty or nothing included) + Cancel; edit mode has a separate "Delete folder" that opens `ConfirmDialog` ("Delete the folder {name}? Chats stay where they are."). Fixed error sentences: `folder_limit` -> server message, `rate_limited` -> "Too many changes. Wait a moment.", else "Could not save the folder. Try again." Every write calls `setFolders` so rail and chips update at once (delete falls back to All chats via the store's existing `setFolders`).
- `FolderRail.tsx`: folder list wrapped in `role="tablist"` with `aria-orientation="vertical"` (foot keys outside it); added "New" key (hidden at 20 folders) opening the editor in create mode; added "Edit" pencil foot key navigating to `/settings/folders`.
- `AppRoutes.tsx`: `/settings/folders` route in `RequireAuth` with a `FoldersRoute` wrapper (same pattern as Blocked). `ChatList.tsx`: "Chat folders" menu item next to "Blocked people".
- Tests: new `FoldersPage.test.tsx` (order+summary, keyboard reorder calls `reorderChatFolders(['f-b','f-a'])` and rolls back with fixed sentence, Create hidden at 20) and `FolderEditorDialog.test.tsx` (create body, Save disabled rules, counter capped at 24, icon pick, pickers capped at 100, delete confirm, `folder_limit` sentence); updated `FolderRail.test.tsx` (tablist, New opens editor, Edit navigates, New hidden at 20) and `ChatList.test.tsx` (menu item navigates).

Files changed (all inside Allowed files):
- `apps/web/src/routes/FoldersPage.tsx` (new), `apps/web/src/routes/FoldersPage.test.tsx` (new)
- `apps/web/src/components/FolderEditorDialog.tsx` (new), `apps/web/src/components/FolderEditorDialog.test.tsx` (new)
- `apps/web/src/components/FolderRail.tsx`, `apps/web/src/components/FolderRail.test.tsx`
- `apps/web/src/routes/AppRoutes.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/ChatList.test.tsx`
- `work/T-0238-web-folders-page-editor.md` (this file)

Commands and real results:
- `pnpm install`: done, 14.1s, exit 0.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/FoldersPage.test.tsx src/components/FolderEditorDialog.test.tsx src/components/FolderRail.test.tsx src/components/ChatList.test.tsx`: 4 files passed, 37 tests passed (fixed 4 of my own test-expectation bugs along the way: multi-select body, counter query, duplicate picker labels, subtitle text).
- `pnpm gate`: GATE PASS — install 1.1s, format, lint, typecheck 9.3s, tests @zilar/web 29.3s; "scope: every changed file is inside the Allowed files"; 10 changed files against main. Ran prettier --write on my touched files once after the first gate run flagged formatting, then gate passed.

Deviations / notes:
- No new dependency added (native HTML5 drag as specced).
- Security checklist: no secrets/tokens in logs or UI; folder writes are the caller's own server folders (no cross-scope `where`); errors are fixed sentences, never raw server text (except `folder_limit`, where the spec says to use the server message — it is the fixed "You can have up to 20 folders." sentence); delete is confirmed in a dialog and scoped to the folder id; no audit entries added; no new routes outside the one `/settings/folders` page (covered by `RequireAuth` like Blocked).
- Did not touch `apps/web/src/mock/**`: the mock API from T-0237 already handles folder reads/writes, and tests mock `@/lib/api` directly.

## Round (fix round, 2026-10-05)

Findings fixed: must-fix #1 (delete `ConfirmDialog` moved out of the editor overlay div to a fragment sibling, so its backdrop click no longer bubbles to the editor's `onClose`). should-fix: none. Nits 2-5 left untouched per instructions (not on a changed line). Disagreements: none.

Tests added: `FolderEditorDialog.test.tsx` — "clicking the delete confirm backdrop keeps the editor open" (opens editor, clicks Delete folder, clicks the confirm backdrop, asserts the editor dialog and Name field are still present and `deleteChatFolder` was not called).

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/FoldersPage.test.tsx src/components/FolderEditorDialog.test.tsx src/components/FolderRail.test.tsx src/components/ChatList.test.tsx`: 4 files passed, 38 tests passed.
- `pnpm gate`: GATE PASS — install 1.1s, format 13.3s, lint 0.7s, typecheck 6.6s, tests @zilar/web 28.6s; "scope: every changed file is inside the Allowed files".

## Round (fix round 2, 2026-10-05)

Findings fixed: should-fix #1 (concurrent reorder race in `FoldersPage.tsx` `persist`): grip buttons are disabled while a reorder is in flight (`reordering` state, `move`/`moveByKey` early-return), and a sequence counter (`reorderSeq` ref) guards the async callbacks so a stale in-flight request can neither apply nor roll back over a newer order. Nits 2 (search input placement) and 3 (rail foot-key arrow indexing) left untouched per instructions (not on a changed line). Disagreements: none.

Tests added: `FoldersPage.test.tsx` — "ignores a second reorder while one is in flight" (holds the first reorder promise open, asserts the second Alt+Arrow move makes no second call and grips are disabled, resolves the first reorder, asserts the store takes the new order and grips re-enable).

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/FoldersPage.test.tsx src/components/FolderEditorDialog.test.tsx src/components/FolderRail.test.tsx src/components/ChatList.test.tsx`: 4 files passed, 39 tests passed.
- `pnpm gate`: GATE PASS — install 0.9s, format 10.9s, lint 0.6s, typecheck 6.8s, tests @zilar/web 19.7s; "scope: every changed file is inside the Allowed files". (Ran prettier --write on the touched test file after the first gate run flagged formatting, re-ran the single FoldersPage test file: 4 passed.)

## Round (lead fix round, 2026-10-05)

One commit per item (`bdd17f90`, `41db034e`, `8f69fd0a`, `76d36ba3`, plus the formatting/report commit). `status: review` kept.

1. Direct-load empty page: `FoldersPage.tsx` now calls `useChatFolders()` on mount (safe to mount twice — ChatShell already does). Test: "syncs folders on mount even with an empty store" (empty store + mocked `listChatFolders` resolves two folders, both Edit buttons appear). `listChatFolders` is mocked in `FoldersPage.test.tsx` with a pending promise by default so other tests' direct `setFolders` calls are not overwritten.
2. Search placement + fixed footer: each `ChatPicker` has its own search field directly above its list ("Search add chats" / "Search exclude chats", separate `includeSearch`/`excludeSearch` state). The dialog is now `flex flex-col overflow-hidden` with a fixed header, a scrolling body (`min-h-0 flex-1 overflow-y-auto`), and a fixed footer with `border-t`. Tests: "filters each picker with its own search field".
3. Switches: type rows and Hide rows use a `button role="switch"` (`aria-checked`, `well-surface` track off / `bg-accent` on, `key-icon` thumb) in a `Switch` helper in the dialog file. Picker checkboxes are styled: `sr-only` native input + 16px (`size-4`) box with `border-border-strong`, lucide `Check` on the accent when checked. Existing tests updated (switch role queries).
4. Hierarchy: three sections each in their own `bg-surface rounded-xl border-border` card with an uppercase muted label (`text-[11px] font-semibold tracking-[0.08em] uppercase`): "Name and icon", "Show these chats", "Hide". Type/Hide rows use `divide-y divide-border` hairlines; name field and icon grid are rows of the first card. Pickers show `max-h-40` (~5 rows) with own scroll plus a muted "N of 100 selected" count line.
5. Page list: all folders in ONE `overflow-hidden rounded-xl border bg-surface` card with `border-b` hairlines (`last:border-b-0`) instead of per-row cards. Summary: `includeChats` empty drops the count ("Personal chats" alone), nothing included at all gives "No rules yet". Extended the order/summary test with a types-only and an empty folder.
6. Nits: (a) duplicate `aria-label` removed from the rail `nav` (the inner tablist keeps `aria-label="Chat folders"`); rail tests now query the tablist/`closest('nav')`. (b) Arrows walk every rail key: unified `keyActions` model (tabs select on move, New/Edit/My AIs/Profile only focus), New and Edit have refs + `onKeyDown`; works with New hidden at 20 via `editIndex`. Test: "arrow keys reach New and Edit" (All → New → Edit → My AIs → Profile, asserting no dialog opens on focus). (c) Stale picks: picked chats that are now archived or topics render as removable "(archived)" rows with a Remove (X) button. Test: "shows picked chats that are no longer pickable as removable rows". Behavior note: selection-follows-focus on folder tabs is unchanged; action keys deliberately do not activate on arrow-over.

Tests: the cap test needed `{ timeout: 60000 }` (100 clicks re-rendering two 100-row pickers take ~11s of the 15s default).

- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/routes/FoldersPage.test.tsx src/components/FolderEditorDialog.test.tsx src/components/FolderRail.test.tsx`: 3 files passed, 21 tests passed.
- `pnpm gate`: GATE PASS — install 0.8s, format 13.1s, lint 0.6s, typecheck 6.8s, tests @zilar/web 21.5s; "scope: every changed file is inside the Allowed files". (First gate run flagged prettier on two files; ran prettier --write, re-ran the 3 single-test files: 21 passed, then gate passed.)

## Review (written by Claude)

**Verdict:** Approved after 2 auto rounds and 1 lead round. In the browser (mock mode, 1456x828), I found what the code reviews had missed:
- the page was empty on a direct load;
- the search field sat under the footer;
- native checkboxes;
- no section hierarchy;
- one card per row;
- "0 chats" in the summaries.

All are fixed (commits `bdd17f90`..`76d36ba3`), including the three earlier pre-review nits. I re-checked in the browser: a direct load lists Personal and AIs in one card; the editor has titled sections (Name and icon, Show these chats, Hide) with switches, a search per picker, and a pinned footer with Delete apart from Save.

The PACKET for the last head reused the pre-fix PREREVIEW.md (17:54): the second pre-review probably died in the network outage (ENOTFOUND), so the final check is the lead's. Nit: the placeholder "Search add chats" reads oddly; use "Search chats".

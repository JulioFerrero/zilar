---
id: T-0238
title: "Web: Chat folders page (/settings/folders) with reorder and the folder editor dialog"
status: planned
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

## Review (written by Claude)

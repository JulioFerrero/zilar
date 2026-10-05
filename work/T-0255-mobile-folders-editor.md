---
id: T-0255
title: "Mobile: Settings → Chat folders (list, reorder, delete) and a folder editor (name, icon, chat types, hide muted/read), through store actions"
status: merged
milestone: M5
branch: task/T-0255-mobile-folders-editor
model: auto
effort: low
depends_on: [T-0248, T-0247]
estimate: 0.6 day
---

# T-0255: mobile Chat folders settings and editor

## Spec (written by Claude, do not edit)

### Why
Mobile shows the server folders as chips (T-0248) but cannot edit them; web can (T-0238). Brief: `docs/design/briefs/telegram-nav-folders-settings.md`. This is part 2a. Picking single chats to include or exclude is a later task.

### Verified facts (do not re-derive)
- **Server routes** (`apps/server/src/chat-folders/routes.ts`), each answering with a body:
  - GET `/chat-folders` (line 103) → `{ folders }`;
  - POST `/chat-folders` (line 108) → `{ folder }`, status 201;
  - PUT `/chat-folders/order` with `{ ids }` (line 130) → `{ folders }`;
  - PATCH `/chat-folders/:id` (line 146) → `{ folder }`;
  - DELETE `/chat-folders/:id` (line 175) → `{ deleted: true }`.
- The web client is the model: `apps/web/src/lib/api.ts` lines 826-871 (`CreateChatFolderInput` with `name`, `icon` and optional `includeTypes`, `includeChats`, `excludeChats`, `excludeMuted`, `excludeRead`; `PatchChatFolderInput` is its `Partial`).
- **Mobile client:** `apps/mobile/src/lib/chat-folders-api.ts`:
  - the interface has only `listChatFolders` (lines 20-22);
  - `request()` (lines 113-142) sends GET only, with no method or body;
  - `parseChatFolder` is at line 76;
  - the factory is `createChatFoldersApi` (lines 145-174);
  - tests are in `apps/mobile/src/lib/chat-folders-api.test.ts`.
- **chat-core** (`packages/chat-core/src/folders.ts`): `FOLDER_ICONS` (24 names, line 5), `ChatFolder` (lines 34-44), `FOLDER_NAME_MAX = 24`, `FOLDERS_MAX = 20`, `sortFolders`, `defaultFolders`.
- **Stores:**
  - `setFolders` is declared in `apps/mobile/src/store/types.ts` line 468, and the state `folders` at lines 165-166;
  - real store: `loadFolders` at `apps/mobile/src/store/real-store.ts` line 455 uses `deps.chatFoldersApi`, and `setFolders` is at line 4011;
  - mock store: `apps/mobile/src/store/chat-store.ts` starts with `folders: defaultFolders()` (line 174), and `setFolders` is at line 1336;
  - the API is injected in `apps/mobile/src/store/chat-store-provider.tsx` line 48.
- **Icons:** `folderIcon(icon)` maps each `FolderIcon` to a lucide icon (`apps/mobile/src/components/chat/folder-icon.ts` line 59).
- **Settings:**
  - the registry `apps/mobile/src/lib/settings-items.ts` is append-only and merged with `merge=union`; Stickers (line 81) is in group `chats`;
  - the hub icon map is `HUB_ICONS` in `apps/mobile/src/app/(tabs)/settings.tsx`;
  - pages use `SettingsScreenShell` with `onBack` (`apps/mobile/src/components/settings/screen-shell.tsx`).
- **Web wording to copy** (`apps/web/src/components/FolderEditorDialog.tsx`):
  - titles "New folder" / "Edit folder";
  - sections "Name and icon", "Show these chats" and "Hide";
  - type labels "Personal chats", "Groups", "Channels", "AIs" (lines 24-29);
  - hide rows "Muted chats" and "Read chats";
  - the delete confirm "Delete the folder {name}? Chats stay where they are."
- Tests may not live under `src/app` (`apps/mobile/src/lib/routes-dir.test.ts`).

### What to build
1. **API:**
   - extend `ChatFoldersApi` with `createChatFolder(input)`, `patchChatFolder(id, input)`, `reorderChatFolders(ids)` and `deleteChatFolder(id)`, with the same input types as web;
   - `request()` gains an optional method and JSON body;
   - responses are parsed with `parseChatFolder`, and a bad shape throws `invalid_response`;
   - tests cover each method's URL, method and body, plus one server error mapped to `ChatFoldersApiError`.
2. **Store actions:**
   - add `createFolder`, `updateFolder`, `deleteFolder` and `reorderFolders` to the store type;
   - real store: call `deps.chatFoldersApi`, then refresh `folders` from the result (create and patch merge the returned folder; reorder takes the returned list; delete removes the id). Errors reach the caller as a rejected promise with the server message.
   - mock store: the same changes applied locally, with new ids `mock-folder-N`;
   - tests for both stores.
3. **Settings row:** append `{ id: 'folders', title: 'Chat folders', subtitle: 'Sort chats into folders.', icon: 'folders', href: '/settings/folders', group: 'chats' }`, and map `folders` to lucide `FolderOpen` in `HUB_ICONS`. The settings-items test checks the row.
4. **`apps/mobile/src/app/settings/folders.tsx`:**
   - one card listing the folders: icon tile, name, a muted summary such as "Personal chats, Groups" or "No chat types", and a `ChevronRight`; tapping a row opens the editor;
   - each row has up and down icon buttons to reorder, calling `reorderFolders`;
   - a "New folder" row at the end opens the editor empty; it is disabled at `FOLDERS_MAX`;
   - empty state: "No folders yet."
5. **`apps/mobile/src/app/settings/folder/[id].tsx`** (`id` is `new` for a new folder). Editor sections:
   - Name and icon: a name input (max `FOLDER_NAME_MAX`, Save disabled while blank) and a 6-column icon grid of `FOLDER_ICONS` with the chosen one raised;
   - Show these chats: four react-native `Switch` rows with the web type labels;
   - Hide: switches for Muted chats and Read chats;
   - a Save button in the header (`right` slot);
   - for an existing folder, a red "Delete folder" row with an inline confirm using the web sentence.
   On success it goes back. On failure it shows the error text under the form and keeps the input. A folder's existing include/exclude chat lists are kept unchanged.
6. **Pure helpers** (the summary text and building the create or patch input from the form) live in `apps/mobile/src/components/settings/folders.ts`, with tests.

### Read first
`AGENTS.md`, `apps/web/src/components/FolderEditorDialog.tsx`, `apps/web/src/routes/FoldersPage.tsx`, `apps/mobile/src/lib/chat-folders-api.ts`, `apps/mobile/src/app/settings/blocked.tsx` (a settings page pattern), `apps/mobile/src/lib/depth.ts`.

### Allowed files
`apps/mobile/src/lib/chat-folders-api.ts`, `apps/mobile/src/lib/chat-folders-api.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/chat-store.test.ts`, `apps/mobile/src/store/real-store.folders.test.ts` (new), `apps/mobile/src/lib/settings-items.ts`, `apps/mobile/src/lib/settings-items.test.ts`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/app/settings/folders.tsx` (new), `apps/mobile/src/app/settings/folder/[id].tsx` (new), `apps/mobile/src/components/settings/folders.ts` (new), `apps/mobile/src/components/settings/folders.test.ts` (new), `apps/mobile/src/components/settings/hub.test.ts` (added by the lead after the worker's question), `work/T-0255-mobile-folders-editor.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-folders-api chat-store real-store.folders settings-items components/settings/folders
pnpm gate
```

### Acceptance
- From Settings → Chat folders you can create, rename, re-icon, change chat types and hide rules, reorder and delete folders. The chips on the Chats tab follow the changes.
- Works in mock mode with no server.
- Lucide icons only, no emoji.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
Picking single chats to include or exclude (later task), drag-to-reorder, and any server or web change.

---

## Report (written by the worker when done)

### What I did

- **API** (`apps/mobile/src/lib/chat-folders-api.ts`): added `CreateChatFolderInput` /
  `PatchChatFolderInput` (same fields as web) and `createChatFolder`,
  `patchChatFolder`, `reorderChatFolders`, `deleteChatFolder` to `ChatFoldersApi`.
  `request()` now takes an optional method and JSON body; write answers are parsed
  with `parseChatFolder` and a bad envelope/row throws `invalid_response`; the list
  still drops malformed rows.
- **Store actions**: added `createFolder`, `updateFolder`, `deleteFolder`,
  `reorderFolders` to `ChatStoreState` (`types.ts`). Real store calls
  `deps.chatFoldersApi` then refreshes `folders` from the answer (create/patch merge
  the returned row, reorder takes the returned list, delete drops the id); errors
  reject with the API's message. Mock store applies the same changes locally with
  `mock-folder-N` ids.
- **Settings**: appended the `folders` registry row in `settings-items.ts` and
  mapped `folders` → lucide `FolderOpen` in `HUB_ICONS`.
- **Pages**: new `app/settings/folders.tsx` (list with icon/name/summary, up/down
  reorder buttons, New folder row disabled at `FOLDERS_MAX`, "No folders yet."
  empty state) and `app/settings/folder/[id].tsx` (`new` for create; name input +
  counter, 6-column `FOLDER_ICONS` grid with the chosen one raised, four
  "Show these chats" switches, Muted/Read hide switches, Save in the header `right`
  slot, inline Delete confirm using the web sentence). Pure helpers in
  `components/settings/folders.ts`.
- Include/exclude chat lists are never sent, so an existing folder's lists are
  kept unchanged.

### Files changed

All inside the Allowed files: `chat-folders-api.ts`/`.test.ts`, `store/types.ts`,
`store/real-store.ts`, `store/chat-store.ts`, `store/chat-store.test.ts`,
`store/real-store.folders.test.ts` (new), `settings-items.ts`/`.test.ts`,
`app/(tabs)/settings.tsx`, `app/settings/folders.tsx` (new),
`app/settings/folder/[id].tsx` (new), `components/settings/folders.ts`/`.test.ts`
(new), `components/settings/hub.test.ts` (added to Allowed files by the lead after
the worker's question), and this task file.

### Commands and results

- `pnpm install`: ok.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-folders-api chat-store real-store.folders settings-items components/settings/folders components/settings/hub`:
  **8 test files, 78 tests passed.**
- `pnpm gate` (final run):
  ```
  PASS  install (frozen)
  PASS  format
  PASS  lint
  PASS  typecheck
  PASS  tests @zilar/mobile
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```
  Earlier gate runs caught and I fixed: 5 files that were not prettier-formatted
  (targeted `prettier --write`); a `react(static-components)` lint error in
  `folders.tsx` (extracted a lowercase `folderGlyph` helper, the `hubIcon`
  pattern); two implicit `any` in `real-store.folders.test.ts` (annotated the fake
  API method parameters).
- `apps/mobile/src/components/settings/hub.test.ts` hardcodes the registry, so the
  new `folders` row broke its two expectations. With the lead's approval I updated
  both: the row-order array now has a second `chats` entry, and the `chats` group is
  `['stickers', 'folders']`. The file was added to the Allowed files in this task.

### Open questions

None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean (2 nits).
- The lead allowed `hub.test.ts` after the worker's question.
- Store writes change state only after the API succeeds, and the UI shows fixed sentences.
- Follow-up from nit 1: a deep link to `/settings/folder/<id>` before the folders have synced starts a blank form, and Save would PATCH `includeTypes: []`. The editor must wait for the folder (or show "Folder not found").
- Nit 2 (mock position collision) is accepted, since the mock is the only thing affected.

The emulator look goes to the next QA run.

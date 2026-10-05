---
id: T-0248
title: "Mobile: chat folders from the server as scrollable chips (All chats + the user's folders), store id-based on the shared matcher"
status: planned
milestone: M5
branch: task/T-0248-mobile-folders-chips
model: deepseek/deepseek-flash
effort: default
depends_on: [T-0231, T-0232, T-0233]
estimate: 0.6 day
---

# T-0248: Mobile folders, part 1 (data and chips)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: folders are fully configurable like Telegram and the same on web and phone. Brief `docs/design/briefs/telegram-nav-folders-settings.md` section e step 4. The web part 1 (T-0237) is merged. Today the phone still shows the hard-coded All / Personal / AIs / Work. Part 2 (the folder editor and the `settings/folders` screen) follows.

### Verified facts (do not re-derive)
- **Server** (T-0232): GET /api/chat-folders → `{ folders }` sorted by position (it seeds Personal and AIs once). The shape is chat-core `ChatFolder` (`packages/chat-core/src/folders.ts`: `ChatFolder`, `FOLDER_ICONS`, `folderMatches`, `folderUnreadTotal(folder | 'all', chats)`, `sortFolders`, `defaultFolders()`). Mobile depends on `@zilar/chat-core`, and mobile `ChatSummary` IS the chat-core type (`apps/mobile/src/lib/types.ts` lines 8-16).
- **Hard-coded today:**
  - `apps/mobile/src/lib/types.ts` line 6 `export type ChatFolder = 'all' | 'personal' | 'ai' | 'work'` (the same name as chat-core's `ChatFolder`; rename the mobile one);
  - `apps/mobile/src/lib/filter.ts` (`CHAT_FOLDERS`, `inFolder`, `unreadCount(chats, folder)`, `filterChats`), used by `apps/mobile/src/lib/chat-list.ts` line 28 and `apps/mobile/src/app/(tabs)/_layout.tsx` line 71 (`unreadCount(chats, 'all')` for the tab badge);
  - `apps/mobile/src/app/(tabs)/index.tsx`: `FOLDER_KEYS` (line 36), `activeFolder`/`setActiveFolder` (lines 55-56), `chatListModel(chats, { folder: activeFolder, search })` (line 118), counts (lines 121-128), `<FolderTabs ...>` (line 348);
  - `apps/mobile/src/components/chat/folder-tabs.tsx` (a well track with a raised segment);
  - store: `activeFolder: ChatFolder` (`apps/mobile/src/store/types.ts` lines 163 and 464), mock store `apps/mobile/src/store/chat-store.ts` (lines 168 and 1209), real store `apps/mobile/src/store/real-store.ts` (lines 3010 and 3988).
- **API client pattern:** `apps/mobile/src/lib/chat-prefs-api.ts` (type guards, no zod, `request()` at line 80, `createChatPrefsApi(getToken, fetchImpl, apiUrl)` at line 114). It is injected in `apps/mobile/src/store/chat-store-provider.tsx` line 46 (`chatPrefsApi`) and read through `deps.chatPrefsApi` in `real-store.ts` (`RealStoreDeps` line 155, `loadPrefRows` lines 440-446).
- **Prefs load points:**
  - boot and refresh: `real-store.ts` lines 2592, 2615 and 2844;
  - the resume listener: `appState.subscribe` around line 1777.

### What to build
1. **Client** `apps/mobile/src/lib/chat-folders-api.ts` (new): `listChatFolders()` with a type-guarded `ChatFolder` parse (icons limited to `FOLDER_ICONS`; drop rows that fail the guard). Use the same pattern as `chat-prefs-api.ts`. Add a test file next to it.
2. **Store** (types, mock, real):
   - `activeFolder: string` (`'all'` or a folder id), `folders: ChatFolder[]` (chat-core type), `setFolders(folders)`. `setFolders` sorts with `sortFolders`; if the active id has vanished, it resets to `'all'`.
   - Real store: an optional `chatFoldersApi` dep, injected in `chat-store-provider.tsx`. Folders load with the chats at boot and on every resume/refresh where prefs load. A failure keeps the last list.
   - Mock store: starts with `defaultFolders()` from chat-core.
   - Rename the mobile union type to `LegacyFolder` only if something still needs it; otherwise delete it.
3. **Filter:** `filter.ts` keeps `filterChats` and `unreadCount`, but they take `folder: ChatFolder | undefined` (undefined = All). Matching uses chat-core `folderMatches`; unread uses `folderUnreadTotal`, so muted chats are skipped as today. Delete `CHAT_FOLDERS` and `inFolder`. `_layout.tsx` keeps the All total.
4. **Chips:** `folder-tabs.tsx` becomes a horizontal `ScrollView` of chips:
   - "All chats" first, then one chip per folder;
   - each chip has its lucide icon (map every `FOLDER_ICONS` name to `lucide-react-native` in a new `apps/mobile/src/components/chat/folder-icon.ts`, fallback `Folder`), the name and the unread count (hidden at 0);
   - the selected chip uses the raised `segment` look, the others are muted;
   - `accessibilityRole="tab"`, selected state, about 34 px tall, 16 px side inset.
   `index.tsx` passes the store's folders and the counts.
5. **Tests:**
   - the API test;
   - `filter` tests updated (folder matching through chat-core, muted skipped, All);
   - a store test (`setFolders` reset; the mock starts with Personal and AIs);
   - a folder-icon map test (every icon name maps);
   - a chips test (renders All + folders, counts hidden at 0).
   (Tests may not live under `src/app`.)

### Read first
`AGENTS.md`, `packages/chat-core/src/folders.ts`, `apps/mobile/src/lib/filter.ts`, `apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/components/chat/folder-tabs.tsx`, `apps/mobile/src/app/(tabs)/index.tsx` (lines 30-130, 340-352), `apps/mobile/src/lib/chat-prefs-api.ts`, `apps/mobile/src/store/chat-store-provider.tsx`, `apps/web/src/lib/useChatFolders.ts` (the web twin).

### Allowed files
`apps/mobile/src/lib/chat-folders-api.ts` (new), `apps/mobile/src/lib/chat-folders-api.test.ts` (new), `apps/mobile/src/lib/filter.ts`, `apps/mobile/src/lib/filter.test.ts`, `apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/lib/chat-list.test.ts`, `apps/mobile/src/lib/types.ts`, `apps/mobile/src/store/**`, `apps/mobile/src/components/chat/folder-tabs.tsx`, `apps/mobile/src/components/chat/folder-tabs.test.tsx` (new), `apps/mobile/src/components/chat/folder-icon.ts` (new), `apps/mobile/src/components/chat/folder-icon.test.ts` (new), `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `work/T-0248-mobile-folders-chips.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-folders-api filter chat-list folder-tabs folder-icon chat-store
pnpm gate
```

### Acceptance
- The phone shows All chats plus the user's server folders as chips. A fresh user sees All chats, Personal, AIs, with no Work. Counts skip muted chats. A deleted active folder falls back to All. Mock mode shows Personal and AIs.
- No server or web change, and no new dependency. `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Creating, editing, reordering and deleting folders on the phone (part 2), the Settings row, chip long-press, swipe between folders.

---

## Report (written by the worker when done)

## Review (written by Claude)

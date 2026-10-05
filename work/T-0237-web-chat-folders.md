---
id: T-0237
title: "Web: chat folders from the server (API client, id-based store, chips on narrow screens, left folder rail on wide screens)"
status: merged
milestone: M5
branch: task/T-0237-web-chat-folders
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: [T-0231, T-0232]
estimate: 0.7 day
---

# T-0237: Web chat folders, part 1 (data, chips, rail)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: the All / Personal / AIs / Work strip must be configurable like Telegram, and on desktop it becomes a left folder rail like Telegram Desktop. Brief `docs/design/briefs/telegram-nav-folders-settings.md` section b and "Decisions" 2, 4, 6; mockup `docs/design/briefs/telegram-nav-folders-settings.html` (v3). This task is part 1: folders come from the server and show as chips (narrow) or a rail (wide). The Chat folders page and the editor dialog are part 2 (T-0238); do not build them here.

### Verified facts (do not re-derive)
- Server routes (T-0232, `apps/server/src/chat-folders/routes.ts`): GET /api/chat-folders → `{ folders }` sorted by position (seeds Personal and AIs once); POST → 201 `{ folder }` (409 `folder_limit`); PATCH /api/chat-folders/:id → `{ folder }`; PUT /api/chat-folders/order body `{ ids }` → `{ folders }`; DELETE /api/chat-folders/:id → `{ deleted: true }`. JSON shape = `ChatFolder` from `packages/chat-core/src/folders.ts` lines 34-44.
- `packages/chat-core/src/folders.ts` exports `ChatFolder`, `FOLDER_ICONS` (line 5), `folderMatches` (line 57), `folderUnreadTotal(folder | 'all', chats)` (line 67), `sortFolders` (line 80); re-exported from `packages/chat-core/src/index.ts` line 13. The web already depends on `@zilar/chat-core` (`apps/web/package.json` line 15).
- API client style: `apps/web/src/lib/api.ts` lines 753-797 (chat-prefs: zod schema + `request(path, schema, init)`). `request` answers from `mockRequest` in mock mode (`api.ts` line 194), so one client serves both modes.
- Mock server: `apps/web/src/mock/api.ts`; chat-prefs handlers at lines 2333-2350, state field `chatPrefs` at line 79 (initial value line 1041).
- Store today (hard-coded folders):
  - `apps/web/src/store/store.ts` line 69 `FolderId = 'all' | 'personal' | 'ais' | 'work'`; state `activeFolder`/`setActiveFolder` lines 370-371, initial line 1054, setter line 1411; `matchesFolder` lines 1416-1427, used at lines 1438 and 1485; `folderUnread` lines 1568-1572.
  - `apps/web/src/store/realStore.ts`: `activeFolder: 'all'` at lines 3318 and 4306, `setActiveFolder` at line 4382.
  - The store is picked in `apps/web/src/store/ChatStoreProvider.tsx` line 22 (`createChatStore()` in mock mode, else `createRealChatStore()`).
- UI today: `apps/web/src/components/FolderTabs.tsx` (hard-coded `FOLDERS` lines 8-13, segmented control in a `Well`), rendered at `apps/web/src/components/ChatList.tsx` line 335; test `apps/web/src/components/FolderTabs.test.tsx`.
- Layout: `apps/web/src/routes/ChatShell.tsx` lines 39-52 (flex row, `wide:gap-3 wide:p-3`, `aside` `wide:w-[360px]` with `ChatList`, then `main`). Wide = `useMediaQuery('(min-width: 900px)')` (`ChatShell.tsx` line 26; tailwind `--breakpoint-wide: 900px`, `apps/web/src/index.css` line 16).
- D24 recipes in `apps/web/src/index.css`: `key-icon`, `segment-raised`, `well-surface` (lines 186-284). Icons: `lucide-react` (`apps/web/package.json` line 21). No emoji.

### What to build
1. **API client** in `apps/web/src/lib/api.ts` (new section after chat-prefs): `chatFolderSchema` (zod, matching `ChatFolder`), `listChatFolders()`, `createChatFolder(input)`, `patchChatFolder(id, input)`, `reorderChatFolders(ids)`, `deleteChatFolder(id)`.
2. **Mock server** in `apps/web/src/mock/api.ts`: in-memory `chatFolders` state seeded on first GET with Personal (`user`, `['dm']`) and AIs (`bot`, `['ai']`), plus the four write routes with the same status codes and error codes as the server (409 `folder_limit` at 20, 404 `not_found`, 400 `invalid_request` for a bad order).
3. **Store, id-based** (both `store.ts` and `realStore.ts`):
   - `activeFolder: string` (`'all'` or a folder id); add `folders: ChatFolder[]` (initial `[]`) and `setFolders(folders)` (stores `sortFolders(folders)`; if the active id is no longer in the list, reset to `'all'`).
   - Replace `matchesFolder` with a function that takes the `ChatFolder | undefined` and uses chat-core `folderMatches` (undefined or `'all'` = every chat, as today). Keep topics working as today at lines 1438 and 1485.
   - Replace `folderUnread(state, folder: FolderId)` with `folderUnread(state, folderId: string)` built on `folderUnreadTotal`.
   - Delete `FolderId`. Logout reset (`realStore.ts` line 4306) also clears `folders`.
4. **Sync hook** `apps/web/src/lib/useChatFolders.ts` (new): on mount and on `window` `focus`, calls `listChatFolders()` and `store.setFolders`; failures keep the current list. Mounted once in `ChatShell.tsx`.
5. **Chips (narrow screens)**: rewrite `FolderTabs.tsx` as a horizontally scrollable `role="tablist"`: first chip "All chats" (always present), then one chip per folder with its lucide icon, name and unread count (hidden at 0). Active chip `segment-raised` + foreground, others muted. Keep the arrow/Home/End keyboard moves. Render it only when not wide (`ChatList.tsx` line 335).
6. **Folder rail (wide screens)**: new `apps/web/src/components/FolderRail.tsx`, a `nav aria-label="Chat folders"` column (about 76 px wide, `bg-panel`, rounded like the aside) placed left of the `aside` in `ChatShell.tsx`, shown only when wide. Items top to bottom: All chats, each folder (icon over name, unread badge on the icon, active item uses `key-icon`), then at the foot a My AIs key (`/settings/ais`) and a Profile key (`/settings/profile`). Same keyboard moves as the chips (ArrowUp/ArrowDown).
7. **Icon map** `apps/web/src/components/folderIcon.tsx` (new): maps every `FOLDER_ICONS` name to its lucide component (fallback `Folder`); a test checks every name maps.
8. **Tests:**
   - `FolderTabs.test.tsx` updated: chips come from the store's folders, counts, keyboard.
   - `FolderRail.test.tsx` (new): renders folders, click sets the active folder, foot keys navigate.
   - A store test (add to the existing store test file that covers `visibleChats`, or a new `apps/web/src/store/folders.test.ts`): `setFolders` resets a vanished active id; a folder filters `visibleChats`; `folderUnread` skips muted.
   - Mock: GET seeds once, POST 409 at 20.

### Read first
`AGENTS.md`, `packages/chat-core/src/folders.ts`, `apps/server/src/chat-folders/routes.ts`, `apps/web/src/lib/api.ts` (lines 180-200, 753-797), `apps/web/src/mock/api.ts` (lines 70-90, 2325-2370), `apps/web/src/store/store.ts` (lines 360-375, 1405-1490, 1560-1575), `apps/web/src/components/FolderTabs.tsx`, `apps/web/src/routes/ChatShell.tsx`, `docs/design/briefs/telegram-nav-folders-settings.md`.

### Allowed files
`apps/web/src/lib/api.ts`, `apps/web/src/mock/api.ts`, `apps/web/src/store/store.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/folders.test.ts` (new), `apps/web/src/lib/useChatFolders.ts` (new), `apps/web/src/components/FolderTabs.tsx`, `apps/web/src/components/FolderTabs.test.tsx`, `apps/web/src/components/FolderRail.tsx` (new), `apps/web/src/components/FolderRail.test.tsx` (new), `apps/web/src/components/folderIcon.tsx` (new), `apps/web/src/components/folderIcon.test.tsx` (new), `apps/web/src/components/ChatList.tsx`, `apps/web/src/routes/ChatShell.tsx`, `apps/web/src/routes/ChatShell.test.tsx`, `apps/web/src/components/ChatList.test.tsx`, `apps/web/src/components/TopicsSidebar.test.tsx` (both added by the lead after the worker's question), `apps/web/src/mock/**`, `work/T-0237-web-chat-folders.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/FolderTabs.test.tsx src/components/FolderRail.test.tsx src/components/folderIcon.test.tsx src/store/folders.test.ts src/routes/ChatShell.test.tsx
pnpm gate
```

### Acceptance
- Folders on the web come from `/api/chat-folders`; a fresh user sees All chats, Personal, AIs; no Work.
- Narrow screens show the chips under the search; wide screens show the rail on the left and no chips.
- Unread counts skip muted chats; an active folder that disappears falls back to All chats.
- No server or mobile change; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
The Chat folders page, the editor dialog, create/rename/delete/reorder UI (T-0238), drag and drop, realtime folder events, mobile.

---

## Report (written by the worker when done)

### What I did
Implemented server-driven chat folders on web (part 1, no editor UI):
- `apps/web/src/lib/api.ts`: new chat-folders section — `chatFolderSchema` (zod, `FOLDER_ICONS` from `@zilar/chat-core`), `listChatFolders`, `createChatFolder`, `patchChatFolder`, `reorderChatFolders`, `deleteChatFolder`.
- `apps/web/src/mock/api.ts`: in-memory `chatFolders` state seeded on first GET with Personal (`user`, `['dm']`) and AIs (`bot`, `['ai']`); POST (201, 409 `folder_limit` at 20), PUT `/order` (400 `invalid_request` on bad order), PATCH/DELETE (404 `not_found`).
- `apps/web/src/store/store.ts` + `realStore.ts`: `activeFolder: string`, `folders: ChatFolder[]` + `setFolders` (sorts via `sortFolders`, resets vanished active id to `'all'`); `matchesFolder(chat, ChatFolder | undefined)` via `folderMatches` (undefined/`'all'` = everything); `folderUnread(state, folderId)` via `folderUnreadTotal` (skips muted); deleted `FolderId`; logout reset clears `folders`.
- `apps/web/src/lib/useChatFolders.ts` (new): syncs `listChatFolders()` into the store on mount and `window` focus; failures keep the current list. Mounted in `ChatShell.tsx`.
- `apps/web/src/components/FolderTabs.tsx`: rewritten as a scrollable `role="tablist"` of chips — "All chats" + one chip per folder (lucide icon, name, unread hidden at 0); active chip `segment-raised`; Arrow/Home/End moves kept. Rendered only when not wide in `ChatList.tsx`.
- `apps/web/src/components/FolderRail.tsx` (new): wide-only `nav aria-label="Chat folders"`, 76px, `bg-panel` rounded like the aside, left of the `aside` in `ChatShell.tsx`; All chats + folders (icon over name, unread badge, active uses `key-icon`), foot keys My AIs (`/settings/ais`) and Profile (`/settings/profile`); ArrowUp/Down/Home/End moves.
- `apps/web/src/components/folderIcon.tsx` (new): maps every `FOLDER_ICONS` name to lucide (fallback `Folder`).
- Tests: updated `FolderTabs.test.tsx`; new `FolderRail.test.tsx`, `folderIcon.test.tsx`, `store/folders.test.ts` (sort + reset, keep active, `visibleChats` filter, muted skip). Per lead approval also updated `ChatList.test.tsx` and `TopicsSidebar.test.tsx` to seed folders via `store.setFolders(...)`, and added seed-once + 409 mock tests to `mock/api.test.ts`.

### Files changed
`lib/api.ts`, `mock/api.ts`, `mock/api.test.ts`, `store/store.ts`, `store/realStore.ts`, `lib/useChatFolders.ts` (new), `components/FolderTabs.tsx`, `components/FolderTabs.test.tsx`, `components/FolderRail.tsx` (new), `components/FolderRail.test.tsx` (new), `components/folderIcon.tsx` (new), `components/folderIcon.test.tsx` (new), `store/folders.test.ts` (new), `components/ChatList.tsx`, `components/ChatList.test.tsx`, `components/TopicsSidebar.test.tsx`, `routes/ChatShell.tsx`, plus this task file.

### Commands and real results
- `pnpm install`: ok (11.7s).
- Targeted (first round): `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/FolderTabs.test.tsx src/components/FolderRail.test.tsx src/components/folderIcon.test.tsx src/store/folders.test.ts src/routes/ChatShell.test.tsx` → 5 files, 15 tests, all pass.
- Lead's checks: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/components/ChatList.test.tsx src/components/TopicsSidebar.test.tsx src/mock/api.test.ts` → 3 files, 74 tests, all pass.
- `pnpm gate`: install PASS, format PASS, lint PASS, typecheck PASS, tests @zilar/web PASS, `scope: every changed file is inside the Allowed files`, **GATE PASS**.

### Follow-up work (per lead approval, 3 commits + 1 format commit)
1. `ChatList.test.tsx` "filters chats by folder": seeds Personal (`['dm']`), AIs (`['ai']`) and a custom Work folder whose `includeChats` names the work chat ids (`c-acme`, `c-devteam`, `c-devai`, `c-qa`, `c-product` + the six Dev team topic chat ids). Same assertions, all pass.
2. `TopicsSidebar.test.tsx` "filters by folder treating topics like their group": seeds Personal + Work the same way. Finding for the Report: **yes, topics need their own chat ids in `includeChats`** — `folderMatches`/`matchesFolder` checks each topic row by its own `chat.id` (not the `groupId`), so the Work folder lists `c-devteam` plus the six topic chat ids (`c-devteam-bug/ui/standup/release/hiring/ideas`). "Treats topics like their group" holds in the sense that naming all of a group's rows keeps the group header; there is no group-id fallback in `folderMatches`.
3. `mock/api.test.ts`: added "seeds Personal and AIs chat folders once on first GET" (names, icons, includeTypes, second GET returns the same list) and "answers 409 folder_limit when creating a 21st chat folder" (2 seeded + 18 created = 20, 21st rejects `{status: 409, code: 'folder_limit'}`).

### Blocked / needs a decision
None — resolved by the lead's approval above.

### Deviations / notes
- `pnpm install` modified `pnpm-lock.yaml` (transitive peer deps `bufferutil`, `utf-8-validate`); I reverted it with `git checkout -- pnpm-lock.yaml` (also re-checked after the final gate — working tree clean of it), so it is not in the diff.
- Security checklist: no secrets/tokens touched; folder CRUD clients send only folder payloads; no new routes on the server; store reset on logout clears folders; no audit/message text involved.

## Review (written by Claude)

**Verdict:** Approved. The packet is clean (1 ARIA nit: the rail's `role="tab"` buttons have no `tablist` parent; fix it in T-0238). Lead round: the two stale folder tests and the mock test were added after the worker asked. I read the store diff: the active id falls back to 'all' when its folder vanishes, and both lists filter through chat-core `folderMatches`. I checked the wide layout in mock mode (lead screenshot, 1440x900): the rail shows All chats 5, Personal 2 and AIs, with My AIs and Profile at the foot, matching mockup v3. Note: the All count now skips archived chats (chat-core `folderUnreadTotal`). Next: T-0238, the Chat folders page and editor dialog.

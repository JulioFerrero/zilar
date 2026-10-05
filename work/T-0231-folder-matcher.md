---
id: T-0231
title: "chat-core: ChatFolder type and the pure folder matcher (shared by web and mobile)"
status: planned
milestone: M5
branch: task/T-0231-folder-matcher
model: opencode/muse-spark-1.3-contributor-free
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0231: Folder matcher in chat-core

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-05: chat folders must be fully configurable like Telegram (brief `docs/design/briefs/telegram-nav-folders-settings.md`, sections b and "Decisions"). Step 2 of the brief's task split: one pure matcher both apps use. No UI and no server in this task.

### Verified facts (do not re-derive)
- `packages/chat-core/src/types.ts` line 132: `ChatSummary` with `id`, `kind: ChatKind` (`'dm' | 'group' | 'ai'`, line 3), `isAI`, `unread`, `muted`, `archived?`, `chatKind?: 'group' | 'channel'` (absent = group).
- `packages/chat-core/src/index.ts` re-exports each module (`export * from './mentions';` style, lines 1-13).
- Today's rule to keep for unread totals: muted chats never count toward a folder total (`apps/mobile/src/lib/filter.ts` lines 23-31).

### What to build
New `packages/chat-core/src/folders.ts`, exported from `index.ts`:
1. Types:
   - `FolderChatType = 'dm' | 'group' | 'channel' | 'ai'`
   - `FOLDER_ICONS` (readonly tuple of the 24 lucide names in the brief section b: `folder, message-circle, user, users, megaphone, bot, briefcase, house, star, heart, bookmark, flag, bell, globe, graduation-cap, gamepad-2, music, camera, shopping-bag, plane, coffee, dumbbell, code, wallet`) and `FolderIcon` (its union).
   - `ChatFolder { id: string; name: string; icon: FolderIcon; position: number; includeTypes: FolderChatType[]; includeChats: string[]; excludeChats: string[]; excludeMuted: boolean; excludeRead: boolean }`.
   - Constants `FOLDER_NAME_MAX = 24`, `FOLDERS_MAX = 20`, `FOLDER_CHATS_MAX = 100`.
2. `chatFolderType(chat: ChatSummary): FolderChatType`: `ai` when `chat.isAI` or `kind === 'ai'`; `dm` when `kind === 'dm'`; `channel` when `kind === 'group'` and `chatKind === 'channel'`; else `group`.
3. `folderMatches(folder, chat): boolean`:
   - archived chats → false;
   - id in `excludeChats` → false;
   - `excludeMuted && chat.muted` → false;
   - `excludeRead && chat.unread === 0` → false;
   - otherwise true when the id is in `includeChats` or its type is in `includeTypes`.
4. `folderUnreadTotal(folder: ChatFolder | 'all', chats)`: sum of `unread` over matching, non-muted, non-archived chats ('all' matches every non-archived chat).
5. `sortFolders(folders)`: by `position`, ties by `id`; returns a new array.
6. `defaultFolders()`: returns the two defaults from the brief's Decisions: Personal (`user`, includeTypes `['dm']`) and AIs (`bot`, `['ai']`), positions 0 and 1, ids `default-personal` / `default-ais`. No Work folder (Julio).
7. Tests `packages/chat-core/src/folders.test.ts`: every branch of `chatFolderType`; include by type, include by id, exclude by id beating include, exclude muted, exclude read, archived never matches; unread total skips muted and archived; 'all' total; sort stability; defaults content; `FOLDER_ICONS` has 24 unique names.

### Read first
`AGENTS.md`, `packages/chat-core/src/types.ts` (lines 1-10, 132-183), `packages/chat-core/src/index.ts`, `apps/mobile/src/lib/filter.ts`.

### Allowed files
`packages/chat-core/src/folders.ts` (new), `packages/chat-core/src/folders.test.ts` (new), `packages/chat-core/src/index.ts`, `work/T-0231-folder-matcher.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/folders.test.ts
pnpm gate
```

### Acceptance
- Pure functions only (no I/O, no React), all exported from `@zilar/chat-core`; web and mobile untouched; no new dependency; `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

### Out of scope
Server table and API, web and mobile UI, wiring the matcher into the apps.

---

## Report (written by the worker when done)

## Review (written by Claude)

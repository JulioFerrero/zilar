---
id: T-0262
title: "Mobile: chat list ticks use the signed-in user id (they never show in the real app), and the folder editor waits for its folder before showing the form"
status: todo
milestone: M5
branch: task/T-0262-mobile-ticks-folder-deeplink
model: auto
effort: low
depends_on: [T-0252, T-0255]
estimate: 0.2 day
---

# T-0262: list ticks and folder editor deep link

## Spec (written by Claude, do not edit)

### Why
Two bugs found in the T-0252 and T-0255 pre-reviews:
1. The chat list rows show read ticks only when `last.senderId === CURRENT_USER_ID` (the constant `'me'`), but the real store sets `currentUserId` to the signed-in user's id. So in the real app your own last message never shows ticks in the list (mock mode hides this, because there the id is `'me'`).
2. The folder editor copies the folder into form state once, on first render. Opening `/settings/folder/<id>` before the folders have synced (a deep link or a cold start) starts a blank form; typing a name and saving would PATCH `includeTypes: []` and wipe the folder's chat types on the server.

### Verified facts (do not re-derive)
- `apps/mobile/src/lib/types.ts` line 2: `CURRENT_USER_ID = 'me'`.
- Real store: `apps/mobile/src/store/real-store.ts` line 2890 sets `currentUserId: me.id` after sign-in (initial value `CURRENT_USER_ID` at line 3028), and own messages get `senderId: meId` (line 2048).
- `apps/mobile/src/components/chat/chat-list-item.tsx` line 70 and `apps/mobile/src/components/chat/topic-row.tsx` line 86: `const showTicks = chat.unread === 0 && last?.senderId === CURRENT_USER_ID;`. Both already read the store's `currentUserId` for the preview (T-0252).
- `apps/mobile/src/app/settings/folder/[id].tsx` lines 47-60: `folder` comes from `state.folders.find(...)`, and `useState(folder?.name ?? '')` and the other fields are snapshotted once.

### What to build
1. Both rows compare against the store's `currentUserId` (the value they already read). Update or add a test in `chat-list-item.test.tsx` and `topic-row.test.tsx` where `currentUserId` is a real id (not `'me'`) and the last message is mine: ticks show. When the last message is someone else's: no ticks.
2. Folder editor:
   - for an existing id, while the folder is not in the store, render a muted "Loading folder…" line and no form;
   - when it appears, initialise the form from it once; the cleanest way is to mount an inner form component with `key={folder.id}` that takes the folder as a prop;
   - if the folders have synced and the id is still missing, show "This folder no longer exists." with a Back button. To tell "not loaded yet" from "missing", use whatever the store exposes; if it exposes nothing, add a `foldersLoaded: boolean` to the store state, set it on the first `setFolders` in both stores, and test it.
   - Put the decision in a pure helper in `apps/mobile/src/components/settings/folders.ts`, `editorState(id, folder, loaded)` returning `'new' | 'loading' | 'missing' | 'ready'`, with tests.

### Read first
`AGENTS.md`, `apps/mobile/src/app/settings/folder/[id].tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/topic-row.tsx`.

### Allowed files
`apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/chat-list-item.test.tsx` (new; follow the mocking pattern of `topic-row.test.tsx`), `apps/mobile/src/components/chat/topic-row.tsx`, `apps/mobile/src/components/chat/topic-row.test.tsx`, `apps/mobile/src/app/settings/folder/[id].tsx`, `apps/mobile/src/components/settings/folders.ts`, `apps/mobile/src/components/settings/folders.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/chat-store.ts`, `apps/mobile/src/store/chat-store.test.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store.folders.test.ts`, `work/T-0262-mobile-ticks-folder-deeplink.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot chat-list-item topic-row components/settings/folders chat-store real-store.folders
pnpm gate
```

### Acceptance
- In the real app, your own last message shows its ticks in the chat list.
- The folder editor never shows a blank form for an existing folder, and never saves over a folder it has not loaded.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

## Review (written by Claude)

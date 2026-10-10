---
id: T-0845
title: "Web store selector hook; MessageBubble, ChatListItem, MessageList and ChatList subscribe only to what they read and are memoised"
status: merged
milestone: M5
branch: task/T-0845-web-store-selectors
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0845: Web store selector hook; MessageBubble, ChatListItem, MessageList and ChatList subscribe only to what they read and are memoised

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Performance finding D-W2 / A-F2 (`docs/audit/simplify-2026-10-09/D-web.md`, `docs/audit/simplify-2026-10-09/A-web-mobile.md`), verified by the lead.
- **The cause:** `apps/web/src/store/ChatStoreProvider.tsx:49-50` `useChatStore()` returns `useAtomValue(useChatStoreApi().atom)`, the whole state. The atom is replaced on every `setState` (`apps/web/src/store/atomStore.ts:55-57`).
- **Call sites:** there are 34. The hot ones:
  - `MessageBubble.tsx:238-239`, which reads only `mediaTrustedHosts` (plus `canPin`/`pinFor`) and is not `memo`;
  - `ChatListItem.tsx:33`, which reads `messages(chat.id)`, `currentUserId`, `typing[...]` and `drafts[...]`;
  - `MessageList.tsx:41`, which renders every loaded message;
  - `ChatList.tsx:61-63`.
- **The effect:** typing, presence and every streamed AI token re-render every bubble and chat row.
- **What already helps:** `messages(chatId)` returns the same array per chat (`apps/web/src/store/realStore.ts`, `get().messagesByChat[chatId] ?? []`), so `memo` will work once the props are stable.
- **The pattern to follow:** mobile already has one (`apps/mobile/src/store/chat-store-provider.tsx:76-86`, plus its `selector-stability.test.ts`).

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
1. Add `useChatSelector<T>(selector: (s: ChatStoreState) => T): T` in `ChatStoreProvider.tsx`. Use `useAtomValue(atom, selector)` from `@effect/atom-react` (check the signature in node_modules) or `useSyncExternalStore`. Keep `useChatStore()` for the other call sites in this task.
2. Convert `MessageBubble`, `ChatListItem`, `MessageList` and `ChatList` to narrow selectors. Selectors must return stable values: no new arrays or objects per call; select the raw slices and derive with `useMemo`.
3. Wrap `MessageBubble` and `ChatListItem` in `memo`, and make the callbacks and props `MessageList`/`ChatList` pass them stable (`useCallback`, `useMemo`).
4. Port the mobile selector-stability idea: a test that a store update unrelated to a chat (for example a typing event in another chat) does not re-render a `MessageBubble` of this chat (count renders with a test-only probe or `React.Profiler`), and that the texts render the same.
5. Do not change what is rendered.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/web/src/store/ChatStoreProvider.tsx`, `apps/web/src/components/MessageBubble.tsx`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/web/src/components/ChatList.tsx`, `apps/web/src/components/*.test.tsx`, `apps/web/src/store/*.test.tsx`, `apps/web/src/store/*.test.ts`, `work/T-0845-web-store-selectors.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot src/components/MessageBubble src/components/ChatList src/components/MessageList src/store
pnpm --filter @zilar/web typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Julio streams an AI reply in a long chat on web and checks it stays smooth.

---

## Report (written by the worker when done)

**What changed**
- `ChatStoreProvider.tsx`: new `useChatSelector(selector)` using `useAtomValue(atom, selector)` (checked in `@effect/atom-react` 4.0.2 `Hooks.js`: it memoises the selected value per source state and `useSyncExternalStore` compares with `Object.is`). `useChatStore()` is kept.
- `MessageBubble`: wrapped in `memo`; subscribes only to `mediaTrustedHosts`, `canPin(chat.id)` (boolean) and `pinFor(chat.id, message.id)`.
- `ChatListItem`: wrapped in `memo`; subscribes to `messagesByChat[id]` (module-level empty fallback), `currentUserId`, `typing[id]?.names` (empty fallback), and a boolean for the draft.
- `MessageList`: narrow selectors (chat pref, default background, messages, history state, draft, finished drafts, user id, `me.jid`); `visibleMessages`, `draftMessage` and `items` are `useMemo`; `hasMore/loadOlder` are read from `storeApi.getState()` at call time. ChatView (not an Allowed file) passes fresh `onReply/onForward/selection` callbacks every render, so a local `useLatestCallback` hands the memoised bubbles wrappers with a fixed identity.
- `ChatList`: one `createRowsSelector()` (per instance, `useMemo`) derives `visibleChats`, `groupChats` and `archivedChats` and caches them on `chats/search/activeFolder/folders`; the rest are scalar selectors. `signOut` is called through `storeApi.getState()`.
- New test `MessageBubble.selectors.test.tsx` (3 tests, `Profiler` commit counts): a typing event in another chat commits 0 extra renders for a `MessageBubble`, a `MessageList` and a `ChatListItem`; a typing event in the item's own chat re-renders it and shows `typing…`; texts render the same.

**Numbers**
- New test against the old code (components stashed): 3 of 3 fail, the subtree commits twice (expected 1 render, got 2) for an unrelated typing event. With the change: 0 extra commits.
- Web tests for the Check filter: 22 files, 287 tests pass (284 before + 3 new). Typecheck clean, oxlint clean, prettier clean.
- Spec facts: all cited lines matched (call sites, `messages(chatId)` returns `messagesByChat[chatId] ?? []`).

**Behaviour differences:** none intended. One note: the draft message `createdAt` (`new Date()`) is now computed when the draft text or messages change, not on every render; it only orders the draft after the last message.

**Unsure:** `ChatView` still uses `useChatStore()` (whole state), so `MessageList` itself still re-renders with it; the bubbles no longer do. Fixing ChatView is outside the Allowed files. `GroupHeaderRow` is not memoised (not in scope).

## Review (written by Claude)

**Lead, 2026-10-10: approved.**
- **What changed:** `useChatSelector` plus memoised `MessageBubble`, `ChatListItem`, `MessageList` and `ChatList`. Render-count tests prove that a typing event elsewhere no longer re-renders the list.
- **Checks:** the combined wave 3 check (full web suite) is clean.
- **Still open:** ChatView and the other `useChatStore()` sites go to T-0879.
- **Live check for Julio:** an AI reply streaming in a long chat on web.

---
id: T-0845
title: "Web store selector hook; MessageBubble, ChatListItem, MessageList and ChatList subscribe only to what they read and are memoised"
status: todo
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

## Review (written by Claude)

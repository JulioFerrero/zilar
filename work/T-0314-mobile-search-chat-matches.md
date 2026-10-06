---
id: T-0314
title: "Mobile fix: chat search shows matching chats and groups above the message hits"
status: todo
milestone: M5
branch: task/T-0314-mobile-search-chat-matches
model: auto
effort: low
depends_on: [T-0309]
estimate: 0.3 day
---

# T-0314: chat name matches in the mobile search

## Spec (written by Claude, do not edit)

### Why
In emulator QA run 17, typing `dev` in the Chats search showed only "Messages / No messages found". The mock has a "Dev team" group, but no chat row appeared. The lead checked the screenshot.

There are two causes:
1. **The 2+ character branch never renders chat matches.** In `apps/mobile/src/app/(tabs)/index.tsx`, the comment at lines 197-201 says it "searches message text across every visible chat below the name matches". But the branch at line 256 (`if (searchOpen && messageQuery !== null)`) renders only the scope chip, `PeopleSearchResult` and `MessageSearchList`.
2. **Groups are never matched by their own name.** `apps/mobile/src/lib/filter.ts:20-30` (`filterChats`) matches only `chat.title`. A group shows up as its topic chats, whose `title` is the topic name (e.g. "General"); the group name is in `chat.groupTitle` (used that way in `components/chat/message-search-list.tsx`).

### Verified facts (do not re-derive)
- **`(tabs)/index.tsx`:**
  - lines 121-124: `const { rows: visibleRows, archived } = useMemo(() => chatListModel(chats, { folder: activeFolderDef, search }), …)`. `visibleRows` is already filtered by `search`;
  - lines 140-146: `closeSearch()`;
  - lines 202 and 256: `messageQuery` is `search` when it has 2+ characters after trimming;
  - the normal list (lines 355-372) renders `ChatListItem` for `kind: 'chat'` rows and `GroupListItem` for `kind: 'group'` rows. Each has `onPress` (a `router.push` to `/chat/[id]` or `/group/[id]`) and `onLongPress={() => openActions(…)}`;
  - the scope chip shows when `searchChat !== undefined`.
- **`apps/mobile/src/lib/chat-list.ts`:** exports `ChatListRow`, `ChatListModel` and `chatListModel`. Its tests are in `apps/mobile/src/lib/chat-list.test.ts`.
- **`apps/mobile/src/lib/filter.ts`:** tests are in `apps/mobile/src/lib/filter.test.ts`.
- **The "Messages" section label style** (`components/chat/message-search-list.tsx:123`): `<Text className="px-[10px] pt-2 text-[12px] font-semibold text-muted-foreground">Messages</Text>` inside a `px-2` container.
- No test imports `(tabs)/index.tsx`.

### What to build
1. **`filterChats`:** a chat also matches when `chat.groupTitle` contains the query, case-insensitive.
   - Add tests in `filter.test.ts`: a topic chat titled "General" with `groupTitle: 'Dev team'` matches `dev`; a non-matching one does not.
2. **In `lib/chat-list.ts`:** export `CHAT_SEARCH_LIMIT = 5` and `chatSearchMatches(rows: ChatListRow[]): ChatListRow[]`, which returns the first `CHAT_SEARCH_LIMIT` rows. Test it in `chat-list.test.ts`.
3. **In the 2+ character branch of `(tabs)/index.tsx`:** when `searchChat === undefined` and `chatSearchMatches(visibleRows)` is not empty, render a "Chats" section between `PeopleSearchResult` and `MessageSearchList`.
   - The section is a `View className="px-2"` with a "Chats" label, styled like the Messages label above.
   - Under the label, the matching rows use the same `ChatListItem` / `GroupListItem` as the normal list.
   - A row's `onPress` calls `closeSearch()` first, then the same `router.push`.
   - `onLongPress` stays as in the normal list.
4. Nothing else in the screen changes.

### Read first
`AGENTS.md`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/lib/filter.ts`, `apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/components/chat/message-search-list.tsx` and the two lib tests.

### Allowed files
`apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/lib/filter.ts`, `apps/mobile/src/lib/filter.test.ts`, `apps/mobile/src/lib/chat-list.ts`, `apps/mobile/src/lib/chat-list.test.ts`, `work/T-0314-mobile-search-chat-matches.md`.

### Checks
```bash
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot filter chat-list
pnpm gate
```

### Acceptance
- Typing `dev` in the Chats search shows a "Chats" section with the Dev team group row above the Messages section.
- Tapping a matching row closes the search and opens that chat or group.
- A one-character query still filters the normal list, and now also matches group names.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

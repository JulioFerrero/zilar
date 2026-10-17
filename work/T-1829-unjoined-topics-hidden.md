---
id: T-1829
title: "A public topic you haven't joined stays out of your chat list and unread counts (it lives under Other topics with Join): the server skips its unread/preview pass, web's sidebar and the phone list drop it"
status: merged
milestone: M5
branch: task/T-1829-unjoined-topics-hidden
model: auto
effort: default
depends_on: [T-1802]
estimate: 30 min
---

# T-1829: Topics you haven't joined stay out of your list

## Spec (written by Claude, do not edit)

### Why
- **Julio chose** that a new public topic includes nobody until people join (T-1802). The boards' README says public means any group member can see it **under Other topics**, read it and join it (`docs/design/mockups/topic-people/README.md:30`).
- **Today it also shows in the chat list:** the web sidebar nests every visible public topic under its group, joined or not (web mock mode, 2026-10-17: "Ideas" and "Release 2.4 notes" under Dev team).
- **And it feeds unread badges:** the server runs the unread pass for every visible topic (`apps/server/src/chats/list-handler.ts:205-208`). So a topic you never joined still adds to your unread counts.

### Facts (read by the lead on 2026-10-17)
- **Server:** `apps/server/src/chats/list-handler.ts` (266 lines).
  - Group entries get `entry.topics = viewsByGroup.get(...)` (`:180-182`).
  - The unread-scope loop: `for (const topic of entry.topics) { scopes.set(topic.chatJid, …); lookups.push(…) }` (`:205-208`).
  - `TopicView.memberIds` is complete: General is every group member, any other topic is direct members plus role holders (`apps/server/src/topics/views.ts:326-336`).
- **Shared:** `isTopicJoined(topic, userId)` (`packages/chat-core/src/topics.ts:57-62`) treats a missing `memberIds` as not joined. The list needs the opposite default (show when unknown), so add a separate helper.
- **Web:** `groupChats(state)` (`apps/web/src/store/chatGroups.ts:36-88`) puts every topic row into `byGroup`, and `state.currentUserId` is `''` until `/api/me` (T-1811).
- **Phone:**
  - `chatListModel(chats, { folder, search })` (`apps/mobile/src/lib/chat-list.ts:29-60`) groups topics with `groupTopicChats`.
  - Its callers are `apps/mobile/src/app/(tabs)/index.tsx:91-94` and `apps/mobile/src/components/chat/chat-list-page.tsx:64-67`.
  - The store has `currentUserId` (`apps/mobile/src/store/types.ts:61`).
- **These rows stay in the store,** because the Join view and the group screens' Other topics read them (`apps/web/src/components/group-info/TopicsSection.tsx:290`, `apps/mobile/src/components/group-info/topics-section.tsx:297-300`). Only the list hides them.

### Steps
1. **chat-core `topics.ts`:** add `export function isUnjoinedTopic(topic: { isGeneral: boolean; memberIds?: readonly string[] } | undefined, userId: string): boolean`. It is true only when `topic` is set, not General, `memberIds` is set, `userId !== ''`, and `memberIds` doesn't include `userId`.
2. **Server `list-handler.ts`:** in the scope loop, skip (`continue`) a topic where `!topic.isGeneral && !topic.memberIds.includes(user.id)`, so it gets no unread, preview or delivery mark. Read the `TopicView` field names before editing.
3. **Web `groupChats`:** skip a chat where `isUnjoinedTopic(chat.topic, state.currentUserId)`, before grouping.
4. **Phone `chatListModel`:**
   - Add `myUserId?: string` to its options, and drop chats where `isUnjoinedTopic(chat.topic, myUserId ?? '')` before grouping.
   - Both callers pass `useChatStore((state) => state.currentUserId)`.
5. **No tests.** Keep every file at most 400 lines.

### Allowed files
- `packages/chat-core/src/topics.ts`
- `apps/server/src/chats/list-handler.ts`
- `apps/web/src/store/chatGroups.ts`
- `apps/mobile/src/lib/chat-list.ts`
- `apps/mobile/src/app/(tabs)/index.tsx`
- `apps/mobile/src/components/chat/chat-list-page.tsx`
- `work/T-1829-unjoined-topics-hidden.md`

### Checks
```bash
pnpm gate
```

### Acceptance
- In web mock mode, the Dev team group in the sidebar lists only General and the topics `u-you` is in, while Ideas still shows under Other topics in the group panel and opens its Join view.
- The phone list behaves the same.
- The server sends no unread for a topic the caller hasn't joined.
- The gate passes.

---

## Report (written by the worker when done)

### What I did

- **`packages/chat-core/src/topics.ts`:** added `isUnjoinedTopic(topic, userId)`. It returns true only when the topic is set, not General, `memberIds` is set, `userId !== ''`, and `memberIds` does not include `userId`. Missing `memberIds` or an empty user id therefore keeps the chat visible (the list needs the opposite default from `isTopicJoined`).
- **`apps/server/src/chats/list-handler.ts`:** in the unread-scope loop, a non-General topic whose `memberIds` does not include the caller is skipped with `continue`, so it gets no unread scope, preview lookup or delivery mark. `TopicView.memberIds` is optional in `apps/server/src/topics/types.ts:72`, so the check uses `!(topic.memberIds ?? []).includes(user.id)`; the server's own `toTopicViews` always populates the list.
- **`apps/web/src/store/chatGroups.ts`:** `groupChats` now skips a chat where `isUnjoinedTopic(chat.topic, state.currentUserId)`, before folder/group handling. The topic rows stay in the store, so the group panel's Other topics and the Join view are unaffected.
- **`apps/mobile/src/lib/chat-list.ts`:** added `myUserId?: string` to the options and filters out unjoined topics before `filterChats`/grouping.
- **Both phone callers** (`apps/mobile/src/app/(tabs)/index.tsx` and `apps/mobile/src/components/chat/chat-list-page.tsx`) pass `useChatStore((state) => state.currentUserId)` as `myUserId` and list it in the `useMemo` dependencies.
- No tests added (spec says none). Every touched file stays under 400 lines.

### Checks run

- `pnpm install`: completed with no output (silent).
- `pnpm gate` (final run):
  ```
  gate: 7 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (0.7s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.4s)
  PASS  tests @zilar/chat-core  (0.6s)
  PASS  tests @zilar/mobile  (1.4s)
  PASS  tests @zilar/server  (12.6s)
  PASS  tests @zilar/web  (3.4s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Earlier gate runs failed on formatting in `apps/mobile/src/lib/chat-list.ts` (fixed with `pnpm exec prettier --write` on that file) and on `TS18048: 'topic.memberIds' is possibly 'undefined'` in `list-handler.ts` (fixed with the `?? []` fallback). I did not run any standalone test file; the gate's per-package tests are the only test runs.

### Notes for the lead

- The mock seed already has "Ideas" and "Release 2.4 notes" without `u-you` (`packages/mock-backend/src/domains/topics/seed.ts:16-22`), and the mock `GET /chats` attaches live topic views (with `memberIds`) to group entries, so the web sidebar should now list only General plus joined topics while Other topics keeps showing them.
- I did not open a browser or the phone app to confirm the visual acceptance criteria; the verification is typecheck, lint and the existing suites.
- Nothing outside the Allowed files changed.

## Review (written by Claude)

Merged. Checked on 2026-10-17:
- The packet matches HEAD `c51836b8d`.
- **chat-core `isUnjoinedTopic`:** a missing member list or an empty user id shows the topic.
- **The server** skips the unread, preview and mark pass for a non-General topic the caller isn't in.
- **Web `groupChats`** and the phone `chatListModel` (with `myUserId` from the store at both callers) drop those rows. The store keeps them, so Other topics and the Join view still work.
- **The lead checks** the sidebar in web mock mode on main after this merge.


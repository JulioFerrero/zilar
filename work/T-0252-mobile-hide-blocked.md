---
id: T-0252
title: "Mobile: a blocked person's messages are hidden in groups and never show as a chat list preview; isBlockedSender and previewMessage move to chat-core"
status: todo
milestone: M5
branch: task/T-0252-mobile-hide-blocked
model: auto
effort: low
depends_on: [T-0239, T-0244, T-0249]
estimate: 0.4 day
---

# T-0252: mobile hides blocked people in groups

## Spec (written by Claude, do not edit)

### Why
Web hides a blocked person's group messages (T-0239) and previews (T-0249). Mobile can block people (T-0244), but it still shows their group messages and previews. This task brings mobile to parity and shares the two pure helpers.

### Verified facts (do not re-derive)
- Web helpers:
  - `apps/web/src/lib/blockedJids.ts`: `localpartOf` is private (lines 13-17); `isBlockedSender(senderId, blocked)` is exported (lines 19-22); the hook `useBlockedJids()` loads `listBlockedUsers()` into a module-level set of lowercased localparts (lines 30-44) and reloads on window focus.
  - `apps/web/src/lib/preview-message.ts`: `previewMessage(chat, messages, blocked, meId)` (33 lines, pure).
  - Both have tests: `apps/web/src/lib/blockedJids.test.ts` and `apps/web/src/lib/preview-message.test.ts`.
- `packages/chat-core/src/index.ts` re-exports one module per line (lines 1-14).
- The mobile real store sets a group message's `senderId` to `message.fromJid` (`apps/mobile/src/store/real-store.ts` line 2040), the same id web filters on.
- The mobile blocked list:
  - `ContactsApi.listBlockedUsers()` returns `BlockedPerson { userId, name, handle, image, jid: string | null }` (`apps/mobile/src/lib/contacts-api.ts` lines 62-79);
  - `useContactsApi()` (`apps/mobile/src/components/contacts/use-contacts-api.ts`) picks the real or the mock API;
  - block and unblock go through `performBlock` / `performUnblock` (`apps/mobile/src/components/contacts/blocks.ts` lines 46-78), which take an `onBlocked` / `onUnblocked` callback.
- Mobile messages: `apps/mobile/src/components/chat/message-list.tsx` line 89 reads `messages` from the store, and lines 123-124 group them.
- Mobile previews: `previewParts(last, ...)` in `apps/mobile/src/components/chat/chat-list-item.tsx` (`last` at line 52, call at line 55), `apps/mobile/src/components/chat/topic-row.tsx` (lines 69 and 73) and `apps/mobile/src/components/chat/group-list-item.tsx` (lines 69-71, where `last` is the newest topic's `lastMessage`).

### What to build
1. **chat-core:**
   - new `packages/chat-core/src/blocked.ts`, holding `isBlockedSender` (with the localpart rule) and `previewMessage`, moved unchanged from web;
   - export it from `index.ts`;
   - add `packages/chat-core/src/blocked.test.ts` (move the web cases for both helpers).
   - Web: `blockedJids.ts` imports `isBlockedSender` from `@zilar/chat-core` and re-exports it. `preview-message.ts` becomes a one-line re-export, or the web imports change to `@zilar/chat-core`. Web behaviour must not change, and the web tests keep passing.
2. **Mobile blocked set:** new `apps/mobile/src/lib/blocked-users.ts`, modelled on the web hook:
   - a module-level set of lowercased localparts;
   - `useBlockedJids()` loads it once through `useContactsApi().api.listBlockedUsers()` and reloads when the app returns to the foreground (`AppState` becomes `active`);
   - a failed load keeps the last good set;
   - an exported `reloadBlockedJids(api)`.
   Call `reloadBlockedJids` from the `onBlocked` / `onUnblocked` success path in `blocks.ts`. Add a test with a fake API covering the load, a failed reload keeping the set, and `reloadBlockedJids`.
3. **Mobile hiding:**
   - `message-list.tsx` drops messages from blocked senders before grouping. This applies only when `chat.kind === 'group'` and `chat.isAI !== true`, and my own messages always stay, the same condition as web `MessageList.tsx` lines 36-41.
   - The three list rows use `previewMessage(chat, store messages for that chat, blocked, currentUserId)` in place of `chat.lastMessage`.
   - Add a test for the message-list filter, and one row test where the last message is from a blocked sender.

### Read first
`AGENTS.md`, `apps/web/src/lib/blockedJids.ts`, `apps/web/src/lib/preview-message.ts`, `apps/web/src/components/MessageList.tsx` (lines 30-45), `apps/mobile/src/components/contacts/blocks.ts`, `apps/mobile/src/components/chat/message-list.tsx` (lines 80-130).

### Allowed files
`packages/chat-core/src/blocked.ts` (new), `packages/chat-core/src/blocked.test.ts` (new), `packages/chat-core/src/index.ts`, `apps/web/src/lib/blockedJids.ts`, `apps/web/src/lib/blockedJids.test.ts`, `apps/web/src/lib/preview-message.ts`, `apps/web/src/lib/preview-message.test.ts`, `apps/web/src/components/ChatListItem.tsx`, `apps/web/src/components/TopicRow.tsx`, `apps/web/src/components/MessageList.tsx`, `apps/mobile/src/lib/blocked-users.ts` (new), `apps/mobile/src/lib/blocked-users.test.ts` (new), `apps/mobile/src/components/contacts/blocks.ts`, `apps/mobile/src/components/contacts/blocks.test.ts`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list.test.tsx`, `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/chat-list-item.test.tsx`, `apps/mobile/src/components/chat/topic-row.tsx`, `apps/mobile/src/components/chat/topic-row.test.tsx`, `apps/mobile/src/components/chat/group-list-item.tsx`, `apps/mobile/src/components/chat/group-list-item.test.tsx`, `work/T-0252-mobile-hide-blocked.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot blocked
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot blockedJids preview-message ChatListItem MessageList
pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot blocked-users blocks message-list chat-list-item topic-row group-list-item
pnpm gate
```

### Acceptance
- On mobile, a blocked person's messages do not show in groups or channels, and never as a list preview. DMs and AI chats are unchanged, and my own messages always show.
- Blocking or unblocking takes effect without restarting the app.
- Web behaviour is unchanged. The helpers live once, in chat-core.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

### Out of scope
Server changes, hiding blocked people's reactions or typing, and the row time and ticks (they follow `chat.lastMessage`, as on web).

---

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-0252
title: "Mobile: a blocked person's messages are hidden in groups and never show as a chat list preview; isBlockedSender and previewMessage move to chat-core"
status: merged
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

### What I did
- **chat-core**: new `blocked.ts` with `localpartOf` (exported), `isBlockedSender` and `previewMessage`, moved unchanged from web; exported from `index.ts`; new `blocked.test.ts` moves the web cases for both helpers.
- **web**: `blockedJids.ts` now imports `isBlockedSender`/`localpartOf` from `@zilar/chat-core` and re-exports `isBlockedSender`; `preview-message.ts` is a one-line re-export. Web behaviour is unchanged and the existing web tests pass untouched.
- **mobile blocked set**: new `apps/mobile/src/lib/blocked-users.ts` — module-level set of lowercased localparts, `useBlockedJids(api)` loads once through `api.listBlockedUsers()` and reloads when `AppState` becomes `active`, a failed load keeps the last good set, and `reloadBlockedJids(api)` is exported. `blocks.ts` awaits `reloadBlockedJids(api)` on the success path of block and unblock, so blocking takes effect without a restart.
- **mobile hiding**: `message-list.tsx` drops a blocked sender's messages before grouping (only when `chat.kind === 'group' && chat.isAI !== true`; my own messages stay). The three rows (`chat-list-item`, `topic-row`, `group-list-item`) preview with `previewMessage(chat, store messages for that chat, blocked, currentUserId)`; time and ticks still follow `chat.lastMessage`, as on web.
- **tests**: new `blocked-users.test.ts` (load, failed reload keeps the set, `reloadBlockedJids`), new `blocks.test.ts` (reload after block/unblock, no reload on failure), new `message-list.test.tsx` (the filter), and a blocked-sender fallback case in `topic-row.test.tsx`.

### Deviations from the spec (with reasons)
1. **`useBlockedJids(api)` takes the API instead of calling `useContactsApi()` itself.** `useContactsApi` imports `expo-router`, which cannot be loaded by the Node/vitest environment (`SyntaxError: Unexpected token 'typeof'`). `blocks.ts` must import `reloadBlockedJids` from `blocked-users.ts`, and `contacts.test.tsx` (not in Allowed files) imports `blocks.ts`; a static `useContactsApi` import in `blocked-users.ts` broke that test. The callers (`message-list` and the three rows) get the API from `useContactsApi().api` and pass it, so the load still goes through `useContactsApi().api.listBlockedUsers()` as specified.
2. **`filterBlockedMessages` pure helper added to `blocked-users.ts`.** The mobile app has no React Native testing library, so the filter is extracted (and `message-list.tsx` calls it) to make the message-list filter testable, the same pattern as `markdown-decision.ts`.
3. **`localpartOf` is exported from chat-core**, not private to `isBlockedSender`: web's `blockedJids.load()` still needs to normalise each `person.jid` when building the set, and keeping the rule in one place avoids duplicating it on web.
4. I did not create `chat-list-item.test.tsx` / `group-list-item.test.tsx`; the requested "one row test where the last message is from a blocked sender" is the new case in `topic-row.test.tsx`. Their component changes are covered by the gate's mobile typecheck/tests.

### Files changed
- `packages/chat-core/src/blocked.ts` (new), `packages/chat-core/src/blocked.test.ts` (new), `packages/chat-core/src/index.ts`
- `apps/web/src/lib/blockedJids.ts`, `apps/web/src/lib/preview-message.ts`
- `apps/mobile/src/lib/blocked-users.ts` (new), `apps/mobile/src/lib/blocked-users.test.ts` (new)
- `apps/mobile/src/components/contacts/blocks.ts`, `apps/mobile/src/components/contacts/blocks.test.ts` (new)
- `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/message-list.test.tsx` (new)
- `apps/mobile/src/components/chat/chat-list-item.tsx`, `apps/mobile/src/components/chat/topic-row.tsx`, `apps/mobile/src/components/chat/topic-row.test.tsx`, `apps/mobile/src/components/chat/group-list-item.tsx`

### Commands run (real results)
- `pnpm install` — completed.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot blocked` — 1 file, 11 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot blockedJids preview-message ChatListItem MessageList` — 4 files, 43 passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot contacts.test blocked-screen blocked-users blocks message-list topic-row` — 6 files, 58 passed.
- `pnpm gate` — ended with `GATE PASS` and `scope: every changed file is inside the Allowed files`:
```
gate: 16 changed file(s) against main
PASS  install (frozen)  (1.3s)
PASS  format  (18.7s)
PASS  lint  (1.0s)
PASS  typecheck  (10.5s)
PASS  tests @zilar/chat-core  (0.8s)
PASS  tests @zilar/mobile  (7.0s)
PASS  tests @zilar/web  (38.5s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Blocked / needs a decision
None.

### Lead fix round
- Wrapped `visibleMessages` in `message-list.tsx` in `useMemo(() => filterBlockedMessages(chat, messages, blockedJids, currentUserId), [chat, messages, blockedJids, currentUserId])`, so an active filter no longer returns a new array on every render and the `items`/`entries` memos and the `FlatList` data stay referentially stable when the inputs are unchanged.
- The requested referential-stability test was **skipped**: the mobile package has no React renderer (no `@testing-library/react-native`, no `react-test-renderer`), and `MessageList` cannot be called as a plain function because it uses `useState`/`useRef`/`useEffect`/`useMemo`/`useSyncExternalStore`. `filterBlockedMessages` itself necessarily returns a new array when it filters, so a helper-level test cannot show the memoised stability; the `useMemo` is covered by typecheck and the existing filter tests. `message-list` + `blocked-users` tests: 8 passed. `pnpm gate`: `GATE PASS`, same scope line.

## Review (written by Claude)

**Verdict:** Approved after one lead fix round.
- The first packet was clean, but the lead found that `visibleMessages` was a new array on every render; it is now memoised (`99a3e7ee`).
- The helpers moved byte-identical to chat-core, and web re-exports them.
- Mobile reloads on foreground and after a block or unblock.

Follow-up from the pre-review nit (pre-existing, not from this task): the mobile rows compare ticks against the `CURRENT_USER_ID` constant (`chat-list-item.tsx:70`, `topic-row.tsx:86`) rather than the store's `currentUserId`, so own-message ticks may not show under real auth.

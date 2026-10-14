---
id: T-1416
title: "The 'Unread messages' divider never sits above your own message: count back only others' messages and land on the first unread message from someone else (shared chat-core, web + mobile)"
status: merged
milestone: M5
branch: task/T-1416-unread-divider-own
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1416: Unread divider skips your own messages

## Spec (written by Claude, do not edit)

### Why
A follow-up from 2026-10-14 (`work/NOW.md`): the "Unread messages" divider once showed **above the sender's own channel post**. Your own messages are never unread, so the divider must never sit directly above one.

### Facts (the lead checked them on main, 2026-10-14)
- **`unreadDividerIndex(items, anchor)`** is in `packages/chat-core/src/messages.ts:295-334`. The `anchor` is the last-read id (a string) or the unread count (a number).
  - **The count path** (`:328-333`): `firstUnread = total - floor(anchor)` over *all* message positions, including your own. So with 1 unread message from someone else followed by 1 of your own, the divider lands on your own message.
  - **The id path** (`:321-327`): it returns `positions[found + 1]`, which can also be your own message.
- **Callers:**
  - web `apps/web/src/components/MessageList.tsx:123` (with `meId` at `:68` from `s.currentUserId`);
  - mobile `apps/mobile/src/components/chat/message-list.tsx:171` (with `currentUserId` at `:111`).
  
  Both pass `items` and the snapshotted `chat.unread`.
- Messages carry `senderId` (`UiMessage`); the mobile file compares `message.senderId === currentUserId` at `:66-67`.
- The tests are in `packages/chat-core/src/messages.test.ts`.

### What to build
1. `unreadDividerIndex(items, anchor, currentUserId)` gets a third parameter, **`currentUserId`**.
   - **The count path:** walk back from the end counting only messages whose `senderId !== currentUserId` until `anchor` of them are counted. The divider goes above the earliest of those. If fewer exist, it goes above the first message from someone else.
   - **The id path:** the first message from someone else after the last-read id.
   - In both paths, **if no message from someone else qualifies, return `null`** (no divider).
   - An album counts as its members, as today.
2. Pass `meId` (web) and `currentUserId` (mobile) at the two call sites. No other change.
3. Update the existing tests in `messages.test.ts` for the new parameter, and add two cases:
   - unread count 1 with the last message your own → the divider sits above the other person's message, not yours;
   - only your own messages after the anchor → `null`.

### Allowed files
`packages/chat-core/src/messages.ts`, `packages/chat-core/src/messages.test.ts`, `apps/web/src/components/MessageList.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `work/T-1416-unread-divider-own.md`.

### Checks
```bash
pnpm --filter @zilar/chat-core exec vitest run src/messages.test.ts --reporter=dot
pnpm gate
```

### Acceptance
The gate passes, and the divider is never directly above your own message on web or mobile.

---

## Report (written by the worker when done)

### What I did

- `packages/chat-core/src/messages.ts`: `unreadDividerIndex` now takes a third
  parameter `currentUserId: string`. While walking the items I collect the
  senders alongside ids/positions (album members count as their own message, as
  before). The **count path** walks back from the end, skips the reader's own
  messages and returns the position of the `anchor`-th message from someone
  else; if fewer than `anchor` exist it returns the earliest message from
  someone else, and `null` when every message is the reader's own. The **id
  path** returns the first message from someone else after the anchor id, or
  `null` if there is none.
- Call sites now pass the reader id: web `MessageList.tsx:123` passes `meId`,
  mobile `message-list.tsx:171` passes `currentUserId`. No other change.
- `packages/chat-core/src/messages.test.ts`: all existing divider calls updated
  to the three-argument form (reader `'me'`), plus two new cases:
  - count 1 with the last message your own → divider lands on the other
    person's message (index 1), not yours;
  - only your own messages unread → `null` (a count case over a list that is
    entirely your own, and the id case with only your own messages after the
    anchor).

### Files changed

`packages/chat-core/src/messages.ts`, `packages/chat-core/src/messages.test.ts`,
`apps/web/src/components/MessageList.tsx`,
`apps/mobile/src/components/chat/message-list.tsx`,
`work/T-1416-unread-divider-own.md`.

### Commands and real results

- `pnpm install`: done, no changes.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2 --reporter=dot src/messages.test.ts`:
  first run 1 failed / 26 passed (my new count-path expectation was wrong: with
  anchor 2 over Ana + two own messages it correctly lands above Ana, per the
  "fewer exist" rule); rewrote that case; re-ran: **27 passed (27)**.
- `pnpm gate` (from the repo root):
  ```
  gate: 5 changed file(s) against main
  PASS  install (frozen)  (2.0s)
  PASS  format  (1.2s)
  PASS  lint  (1.7s)
  PASS  typecheck  (7.7s)
  PASS  effect  (1.5s)
  PASS  tests @zilar/chat-core  (0.6s)
  PASS  tests @zilar/mobile  (1.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / notes

- None from the spec. Reader ids are typed `string` in both stores, so the
  `string` parameter needs no coercion. When the store has not loaded a user
  yet it holds `''`, which matches no message, so the divider falls back to the
  previous behaviour until the id arrives.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 0. Read the diff:
- the count path counts back only others' messages and falls back to the earliest one of theirs;
- the id path skips the reader's own messages;
- all-own gives null.
The messages tests pass locally (27). Web and mobile each change one call site.

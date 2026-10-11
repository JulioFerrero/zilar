---
id: T-1147
title: "Web + mobile: leaving a chat clears the open chat, so a message arriving while you are on the chat list stays unread and is never marked seen for the sender"
status: merged
milestone: M5
branch: task/T-1147-close-chat-clears-active
model: auto
effort: default
depends_on: []
estimate: 0.2 day
---

# T-1147: Leaving a chat clears the open chat

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-11: with no chat open (on the chat list), a message from another account shows as **seen** for the sender, though he never read it.

**What the lead read:**
- **The core** marks an incoming message read and sends the displayed marker when `activeChatId === chatId && ports.isVisible()` (`packages/client-core/src/store/incoming.ts:127-128`, then `:165-171`: `recordRead` and `markDisplayed`).
- **Web:** `ChatView` calls `openChat(chat.id)` in an effect (`apps/web/src/routes/ChatView.tsx:89-91`) with **no cleanup**. `openChat` sets `activeChatId` (`apps/web/src/store/effects/history.ts:32-38`). Nothing clears it when the user goes back to the list; it is cleared only when the open chat disappears (`history.ts:180`, `:186`). So after visiting a chat, that chat stays "active" while the list is on screen, and its new messages are marked seen.
- **Mobile:** the same pattern. `use-chat-screen.ts:95-99` calls `openChat(chatId)` with no cleanup, and `activeChatId` is cleared only in `apps/mobile/src/store/effects/history.ts:208-217`.
- **The store actions:** web `openChat` is declared in `apps/web/src/store/store.ts:241` and wired in `apps/web/src/store/effects/chatActions.ts:122-123`. Mobile `openChat` is declared in `apps/mobile/src/store/types.ts:122` and wired in `apps/mobile/src/store/real-store.ts:286`.

### What to build
1. **Web:** add `closeChat: (chatId: string) => void` to the store interface (`store.ts`, next to `openChat`). Wire it in `chatActions.ts`: when `get().activeChatId === chatId`, set `activeChatId: undefined`; otherwise do nothing, so switching from chat A to chat B, where B's open runs first, never clears B. In `ChatView.tsx`, return a cleanup from the `openChat` effect that calls `closeChat(chat.id)`.
2. **Mobile:** the same. Add `closeChat` to `types.ts` and wire it in `real-store.ts`, setting `activeChatId: null` only when it equals `chatId`. In `use-chat-screen.ts`, return the cleanup from the `openChat` effect (`:95-99`).
3. **Any other store** that implements these interfaces (mock or test stores) gets a no-op `closeChat`. Typecheck shows them; list each one in the Report. If one is outside the Allowed files, stop and ask.
4. **Keep** the existing read behaviour when the chat really is open and visible.
5. **One test** (the message pipeline), in `apps/web/src/store/realStore.incoming.test.tsx`, following its existing `openChat(ANA)` tests: `openChat(ANA)`, then `closeChat(ANA)`, then an incoming message from ANA. The chat's `unread` must be 1 and no displayed marker sent.

### Read first
`AGENTS.md`, `packages/client-core/src/store/incoming.ts:118-172`, `apps/web/src/routes/ChatView.tsx:85-95`, `apps/web/src/store/effects/history.ts:30-45`, `apps/web/src/store/effects/chatActions.ts:110-130`, `apps/mobile/src/components/chat/use-chat-screen.ts:90-110` and `apps/web/src/store/realStore.incoming.test.tsx:95-130`.

### Allowed files
`apps/web/src/store/store.ts`, `apps/web/src/store/effects/chatActions.ts`, `apps/web/src/routes/ChatView.tsx`, `apps/web/src/store/realStore.incoming.test.tsx`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/components/chat/use-chat-screen.ts`, `work/T-1147-close-chat-clears-active.md`.

### Checks
```bash
pnpm --filter @zilar/web exec vitest run src/store/realStore.incoming.test.tsx --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched source file stays at most 400 lines.
- **The lead's check on the live web:**
  - open a chat, go back to the list, and have another account send a message: the chat shows unread, and the sender sees no "seen";
  - opening the chat then marks it seen.

---

## Report (written by the worker when done)

### What I did

Added `closeChat(chatId)` so leaving a chat clears `activeChatId`, keeping messages that
arrive while the chat list is on screen unread and unmarked for the sender.

- **Web** — `apps/web/src/store/store.ts`: declared `closeChat: (chatId: string) => void`
  next to `openChat`. `apps/web/src/store/effects/chatActions.ts`: added `closeChat` to the
  `ChatActions` pick and wired it to clear `activeChatId` only when
  `get().activeChatId === chatId` (so a switch A→B, where B's open runs first, never clears B).
  `apps/web/src/routes/ChatView.tsx`: the `openChat` effect now returns a cleanup calling
  `storeApi.getState().closeChat(chat.id)`.
- **Mobile** — `apps/mobile/src/store/types.ts`: declared `closeChat`. `apps/mobile/src/store/real-store.ts`:
  wired it directly (guarded `set({ activeChatId: null })`). `apps/mobile/src/components/chat/use-chat-screen.ts`:
  selected `closeChat` from the store and returned the cleanup from the `openChat` effect.
- **Test** — `apps/web/src/store/realStore.incoming.test.tsx`: added a case after the
  hidden-tab one: `openChat(ANA)`, `closeChat(ANA)`, then an incoming message from ANA;
  the chat's `unread` is 1 and no displayed marker is sent.

The read behaviour when the chat is really open and visible is unchanged (the core's
`activeChatId === chatId && ports.isVisible()` path in `packages/client-core/src/store/incoming.ts`).

### Other stores implementing the interfaces

None needed a no-op `closeChat`. Both mock modes build the real store with fake ports
(web `ChatStoreProvider.tsx` → `createRealChatStore()`; mobile `chat-store-provider.tsx` →
`createRealChatStore(mockStoreDeps())`), so the web store and the mobile store are the only
implementers. Typecheck passed, confirming this.

### Files changed

`apps/web/src/store/store.ts`, `apps/web/src/store/effects/chatActions.ts`,
`apps/web/src/routes/ChatView.tsx`, `apps/web/src/store/realStore.incoming.test.tsx`,
`apps/mobile/src/store/types.ts`, `apps/mobile/src/store/real-store.ts`,
`apps/mobile/src/components/chat/use-chat-screen.ts`, `work/T-1147-close-chat-clears-active.md`.
All touched source files are ≤ 400 lines (largest: `store.ts` 393).

### Commands I ran

- `pnpm install` — done.
- `pnpm --filter @zilar/web exec vitest run src/store/realStore.incoming.test.tsx --reporter=dot`
  — 1 file passed, 10 tests passed.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.history.test.ts`
  — 1 file passed, 7 tests passed.
- `pnpm gate` — GATE PASS:
  ```
  gate: 8 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (0.9s)
  PASS  lint  (0.9s)
  PASS  typecheck  (4.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/mobile  (2.8s)
  PASS  tests @zilar/web  (4.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Deviations / open questions

None. The mobile store's own `openChat` implementation lives in
`apps/mobile/src/store/effects/history.ts` (not in the Allowed files), so per the spec I wired
`closeChat` directly in `real-store.ts` rather than alongside it.

## Review (written by Claude)

**Lead, 2026-10-11: approved. The pre-review is clean, with no nits.**
- **The new action:** web and mobile get `closeChat(chatId)`. It clears `activeChatId` only when it is still that chat.
- **Where it runs:** `ChatView` (web) and `use-chat-screen` (mobile) call it from the cleanup of their `openChat` effect. On a switch from A to B, A's cleanup runs before B opens, so B stays open.
- **Test:** the new incoming test (closed chat: unread 1, no displayed marker) passes in the branch, 10 of 10, run by the lead.
- **Still to do:** the lead's live check on the web after the deploy.

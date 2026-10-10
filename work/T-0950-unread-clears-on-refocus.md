---
id: T-0950
title: "Unread clears on refocus: when the app or tab comes back to the foreground with a chat open, that chat is marked read (web and mobile, through the core focus hook)"
status: todo
milestone: M5
branch: task/T-0950-unread-clears-on-refocus
model: auto
effort: default
depends_on: []
estimate: 0.25 day
---

# T-0950: Unread clears on refocus

## Spec (written by Claude, do not edit)

### Why
T-0948's worker traced a badge the lead saw, and the lead confirmed the cause in the code on 2026-10-10:
- an incoming message marks the open chat read only while the page is visible (`packages/client-core/src/store/incoming.ts:124`: `activeChatId === chatId && ctx.ports.isVisible()`);
- while hidden, `unread` goes up, which is right; `apps/web/src/store/realStore.incoming.test.tsx:115` asserts it;
- **when the user comes back** with the same chat still open, nothing clears it. The badge stays until they leave the chat and reopen it, unlike Telegram.

Both apps already give the core a focus hook: `visibility.onFocus` (`packages/client-core/src/store/ports.ts:59`), set from `window` focus on web (`apps/web/src/store/effects/ports.ts:279-285`, `:363`) and from `AppState` on mobile (`apps/mobile/src/store/effects/ports.ts:88-110`). `whileFocused` in `packages/client-core/src/store/polling.ts:51-58` registers handlers on it. `recordRead(ctx, chatId, messageId)` (`packages/client-core/src/store/reads.ts:25`) clears a chat's unread, saves the last read and syncs the badge.

### What to build
1. **On each focus** while the store runs: if `activeChatId` is set and that chat has `unread > 0`, call `recordRead` with the chat's newest message id. Register it with `whileFocused` in the core, next to the existing chats refresh (`polling.ts:60-63`) or in a small helper beside it, so web and mobile both get it with no app change.
2. **Send the read marker the server needs,** the same way opening a chat does (find what `openChat` sends; reuse it rather than duplicating it).
3. **One test** (message pipeline, so it counts as crucial under Julio's rule) in `packages/client-core/src/store/reads.test.ts` or the nearest kept core test: a message arrives while hidden, the chat stays open, `unread` is 1; then a focus fires and `unread` is 0 with the read recorded. Use the core fakes (`ports.ts:192`).
4. **No other behaviour change.** `realStore.incoming.test.tsx:115` still passes.

### Read first
`AGENTS.md`, `packages/client-core/src/store/reads.ts`, `incoming.ts:110-170`, `polling.ts`, `ports.ts`, and where the core opens a chat and marks it read (grep `recordRead`).

### Allowed files
`packages/client-core/src/store/polling.ts`, `packages/client-core/src/store/reads.ts`, `packages/client-core/src/store/reads.test.ts`, `packages/client-core/src/store/incoming.test.ts`, `work/T-0950-unread-clears-on-refocus.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- The new test fails on the old code and passes on the new.
- The Report shows both runs.
- Live check for Julio: with a chat open, switch to another app or tab, get a message, and come back: the badge clears.

---

## Report (written by the worker when done)

## Review (written by Claude)

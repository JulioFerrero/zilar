---
id: T-0950
title: "Unread clears on refocus: when the app or tab comes back to the foreground with a chat open, that chat is marked read (web and mobile, through the core focus hook)"
status: merged
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

**Status:** review

**What I did**
- Added `clearActiveChatRead(ctx)` to `packages/client-core/src/store/polling.ts`. On each focus while the store runs: if `activeChatId` is set and that chat has `unread > 0`, it calls `recordRead(ctx, chatId, chat.lastMessage?.id)` and then sends the read marker opening a chat sends, `ctx.core.markDisplayed(chatId, coreKind(chat), messageId)`.
- Registered it inside the existing `whileFocused(ctx, ...)` of `chatsPolling`, right next to `ctx.fx.refreshChats()`. `startChatsPolling` is started by core `lifecycle.ts` (lines 271-273) for both apps, so web and mobile get it with no app change.
- Added one message-pipeline test in `packages/client-core/src/store/incoming.test.ts` ("clearing the open chat on refocus (core)"): a message arrives while hidden with the chat open -> `unread` is 1 and nothing is marked read; the visibility fake then fires focus -> `unread` is 0, `markDisplayed(ANA, 'chat', 'ana-1')` and `dismissChatNotifications(ANA)` are called.

**Files changed**
- `packages/client-core/src/store/polling.ts` (new import of `recordRead` and `coreKind`; new `clearActiveChatRead`; focus handler).
- `packages/client-core/src/store/incoming.test.ts` (new test + imports).
- `work/T-0950-unread-clears-on-refocus.md` (status).

No app files changed, so there is no behaviour change beyond the fix.

**Commands and real results**
- `pnpm install`: Done in 10.3s (only the pre-existing `@types/react-dom` peer warning).
- New code: `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts src/store/polling.test.ts` -> 2 files passed, 22 passed.
- Old code (with `packages/client-core/src/store/polling.ts` stashed): `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/incoming.test.ts` -> 1 failed | 14 passed; the new test failed with `AssertionError: expected 1 to be +0` (unread stayed 1). It passes on the new code, so it fails on old and passes on new.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/realStore.incoming.test.tsx` -> 9 passed (the hidden-chat unread assertion still passes).
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.incoming.test.ts` -> 8 passed.
- `pnpm gate` (repo root):
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (0.9s)
  PASS  format  (1.1s)
  PASS  lint  (0.8s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.6s)
  PASS  tests @zilar/client-core  (1.1s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

Note on the task's Checks: following AGENTS.md and the lead's instruction I did not run the three whole-package `vitest run` commands one by one; `pnpm gate` runs the format/lint/typecheck and the tests of the packages I touched (only `@zilar/client-core`), and I ran the specific affected web and mobile test files above for the cross-app regression. The gate ends with `GATE PASS` and lists no file outside the Allowed files.

**Deviations / notes**
- The spec offered `reads.test.ts` or "the nearest kept core test"; `packages/client-core/src/store/reads.test.ts` does not exist, so the test went into the kept core test `incoming.test.ts`, which already covers the hidden-chat unread case.
- "reuse it rather than duplicating it": I did not add a new server call; I reused the exact marker the open-chat path uses (`core.markDisplayed(chatId, coreKind(chat), messageId)`), the same call as `incoming.ts:166` and `history.ts:282`.

**Live check for Julio:** with a chat open, switch to another app or tab, get a message, and come back: the badge clears.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with 1 nit.**
- **The fix:** `clearActiveChatRead` in `packages/client-core/src/store/polling.ts` runs on each focus beside the chats refresh. When the open chat has unread messages, it calls `recordRead` and sends `markDisplayed` for the newest message, the same pair that opening a chat uses. Web and mobile both get it through the core.
- **The test:** one message-pipeline test in `incoming.test.ts`. It fails on the old code and passes on the new. The web and mobile incoming tests still pass.
- **Check:** the gate passed. `polling.ts` is 230 lines.
- **Live check for Julio:** with a chat open, switch to another app or tab, get a message, and come back: the badge clears.

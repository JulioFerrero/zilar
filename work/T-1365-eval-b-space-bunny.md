---
id: T-1365
title: "Model eval B: replay of T-1361 on opencode-go/space-bunny (base fce08c06c; never merged)"
status: todo
milestone: M5
branch: task/T-1365-eval-b-space-bunny
model: opencode-go/space-bunny
effort: default
depends_on: []
estimate: 0.5 day
eval_base: fce08c06c
---

# T-1365: Model eval B (space-bunny)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: "i get the notification but when i enter the app, i dont see the counter in the chat that the message is from". He opened Zilar **from the icon**, not by tapping the notification.

**The lead reproduced it on his phone** (build `94071eb8`, main with T-1356..T-1360), test 12:
- **12:30:25Z:** Claude Test sends Julio a DM while Zilar is killed. The server logs `push sent`.
- **12:30:27Z:** the woken app's headless task fetches `GET /api/push/preview` (200). Since T-1257 that also forks a *delivered* mark (`apps/server/src/push/preview-delivered.ts`). The app process stays alive.
- **12:30:48Z:** the lead launches Zilar the way the icon does (`monkey -c LAUNCHER`). The app calls `/api/me`, `/api/chats`, `/api/contacts`, `/api/chat-prefs`, `/api/xmpp/token`, `/api/chat-folders`, `/api/push/subscriptions`. **No `PUT …/read` is sent.** The screen stays on the chat list (screenshot: Claude Test row with "Push test 12 …", 14:30, **no badge**; Zilar Updates row with badge 1; "All chats 1").
- **Live DB after the launch:** `zilar.chat_reads` for Julio and the Claude Test DM still has `last_read_id = 1791980387430767` (test 11, 12:19:47). The archive row for test 12 is `timestamp 1791981025538427`. **So the server should count 1 unread for this DM.**

### What to do
Find the layer that loses the count. Prove each step with a small test or a cited code path; don't guess.
1. **Server:** does `unreadForChats` (`apps/server/src/chats/unread.ts`) return `unread: 1` for a DM whose read mark is older than the newest message, **when a delivered mark exists** for that message (written by `forkPreviewDelivered` → `markDeliveredAndNotify`, `apps/server/src/chats/delivered-notice.ts`)? Add one server test for exactly this case; the message pipeline allows tests.
2. **Client list merge:** `mergeUnread` (`packages/client-core/src/store/chat-rows.ts:121-145`) and its caller `apps/mobile/src/store/effects/history.ts:186-231`. Could memory win with `unread: 0` because the in-memory row already has an equal-or-newer `lastMessage` from the XMPP catch-up?
3. **Catch-up / incoming:** `packages/client-core/src/store/incoming.ts:150-185` (`isRead = activeChatId === chatId && ports.isVisible()`) and `ledger-incoming.ts:212-226` (`setChatMessage(…, clearUnread)`). Could a stream-resumption or MAM catch-up path deliver test 12 with `clearUnread`/`isRead` true, or replace the row without adding 1?
4. **Headless wake in the same process:** `apps/mobile/src/lib/push/background.ts` (`onWake`, `handleWake`) and `apps/mobile/src/lib/push/badge.ts`. Does anything there touch the chat store, notifications or read state, so that a later UI start in the same JS runtime starts with that DM at 0?
5. **Fix it at the layer you proved.** Keep the open-chat rule: the chat on screen stays at 0. **Web parity:** if the cause is in `packages/client-core` or the server, web gets it too; say whether web is affected.
6. **Tests:** at most 2, only for the server or client-core unread logic. No UI tests. Every file stays at most 400 lines.

### Read first
`AGENTS.md`, the files above, `apps/server/src/chats/api.ts` (where `unreadForChats` feeds `GET /api/chats`), `packages/client-core/src/store/reads.ts`.

### Allowed files
`apps/server/src/chats/*.ts`, `apps/server/src/push/preview-delivered.ts`, `packages/client-core/src/store/*.ts`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/lib/push/*.ts`, `apps/web/src/store/**/*.ts`, `work/T-1365-eval-b-space-bunny.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The Report names the exact cause,** with `file:line` and the test that proves it.
- **The lead re-runs test 12 on Julio's phone:** the badge shows 1 after opening from the icon.

---

### Eval rules (model test, read first)
This is a model-quality test that replays a task already solved on `main`. The lead grades your result; it will never be merged.
- Work alone. Nobody will answer questions. When unsure, decide, and note the decision in the Report.
- Do the task exactly as specified above, then run `pnpm gate`.
- Write the Report below: the cause or what you built, with `file:line`, every change, and the real `pnpm gate` output. Then set `status: eval-done` in the front matter. **Never set `status: review`.**

---

## Report (written by the worker when done)

## Review (written by Claude)

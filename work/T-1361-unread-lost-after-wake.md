---
id: T-1361
title: "Mobile: after a push wakes the closed app, opening Zilar from the icon shows the DM with no unread badge although the server read mark is older than the message — find where the count is lost (server unread, list merge, catch-up or the headless wake) and fix it"
status: merged
milestone: M5
branch: task/T-1361-unread-lost-after-wake
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1361: Unread lost after a wake

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
`apps/server/src/chats/*.ts`, `apps/server/src/push/preview-delivered.ts`, `packages/client-core/src/store/*.ts`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/lib/push/*.ts`, `apps/web/src/store/**/*.ts`, `work/T-1361-unread-lost-after-wake.md`.

### Checks
```bash
pnpm gate
```

### Acceptance
- The gate passes.
- **The Report names the exact cause,** with `file:line` and the test that proves it.
- **The lead re-runs test 12 on Julio's phone:** the badge shows 1 after opening from the icon.

---

## Report (written by the worker when done)

### The exact cause

**The mobile-only DM row mapper hardcoded `unread: 0` and dropped the server
preview.** `apps/mobile/src/store/effects/chat-rows.ts:22-45` (before the fix)
had its own `summaryFor` whose DM branch returned `unread: 0` and never read
`entry.unread` / `entry.lastMessage`. Group entries already went through the
shared core mapper (`apps/mobile/src/lib/topics.ts:29-34` →
`@zilar/client-core/store` `summariesFor`), which is why **Zilar Updates (a
channel/group) showed its badge 1 and the Claude Test DM showed none** in the
lead's screenshot.

Both mobile paths that build rows used that lossy mapper:

- boot: `packages/client-core/src/store/lifecycle.ts:235` calls
  `ctx.ports.rows.summariesFor`, which mobile wires to the local mapper at
  `apps/mobile/src/store/real-store.ts:182`;
- refresh: `apps/mobile/src/store/effects/history.ts:187` calls
  `h.summariesFor`, the same local mapper (`real-store.ts:259`).

So the server's correct `unread: 1` for the DM never reached the row
(`apps/mobile/src/store/effects/history.ts:205` `applyBoot` stores whatever
`freshRows` holds). The row's preview text ("Push test 12 …") came from the MAM
`loadPreview` fallback (`packages/client-core/src/store/history.ts:181-220`),
which fills `lastMessage` for a row that has none and never touches `unread`:
a preview with no badge, exactly the report.

### What I proved, layer by layer

1. **Server — not the cause.** `unreadForChats` counts from `chat_reads` only
   (`apps/server/src/chats/unread.ts:310-317`, `240-288`); the delivered mark
   lives in `chat_deliveries` (`apps/server/src/chats/deliveries.ts:106-132`)
   and never feeds the count. New test
   `apps/server/src/chats/unread-wake.test.ts` seeds an archive row after the
   read mark plus a `chat_deliveries` row for that same message (the wake's
   forked mark) and asserts `/api/chats` still reports `unread: 1` and the
   preview. It passes.
2. **Client list merge — not the cause once rows are right.** `mergeUnread`
   (`packages/client-core/src/store/chat-rows.ts:121-146`) is correct given a
   fresh row that carries the server `unread`/`lastMessage`; the loss happened
   before the merge, inside the mapper that built the fresh row.
3. **Catch-up / incoming — not the cause.** `handleMessage`
   (`packages/client-core/src/store/incoming.ts:153-162`) sets `isRead` only
   for the open, visible chat; nothing here was involved.
4. **Headless wake — not the cause.** `onWake`/`handleWake`
   (`apps/mobile/src/lib/push/background.ts:196-223`) and `badge.ts` never touch
   the chat store, notifications state or read state; the headless task only
   fetches the preview (and the server forks the delivered mark).
5. **Fix at the proven layer.** `apps/mobile/src/store/effects/chat-rows.ts`
   now delegates `summariesFor` to the shared
   `@zilar/client-core/store` mapper for every entry, so mobile DM rows carry
   the server `unread`, `lastMessage`, `readUntil` and `deliveredUntil`, like
   its group rows already did. The open-chat rule
   (`packages/client-core/src/store/chat-rows.ts:127-128,142-144`) is untouched:
   the chat on screen still ends at 0.

**Web parity:** web's `chatRows.ts` already re-exports and uses the shared core
`summariesFor` (`apps/web/src/store/effects/chatRows.ts:5,12`), so **web was
never affected**; the cause is mobile-only and the fix is mobile-only.

### How I found it (direct reproduction)

A temporary mobile test booted a store whose `/api/chats` DM entry carried
`unread: 3` and a preview. Before the fix `chat.unread` was `0` (test failed);
after the fix it was `3` with preview `hey`. The temporary file was removed
(it would sit outside the spec's test scope, see below).

### Files changed

- `apps/mobile/src/store/effects/chat-rows.ts` — the fix (33 lines).
- `apps/server/src/chats/unread-wake.test.ts` (new, 136 lines) — the server test.
- `packages/client-core/src/store/unread-merge.test.ts` — one added test
  (`a DM entry maps the server unread, preview and delivered mark (T-1361)`,
  188 lines).
- `work/T-1361-unread-lost-after-wake.md` — this Report.

### Commands run (real results)

- `pnpm install` — done (11.8s).
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/chats/unread-wake.test.ts` — **1 passed**.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/unread-merge.test.ts` — **7 passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store` — **9 files, 52 passed** (regression check on the touched mapper).
- `pnpm gate` (repo root):
  ```
  gate: 4 changed file(s) against main
  PASS  install (frozen)  (0.8s)
  PASS  format  (1.0s)
  PASS  lint  (0.8s)
  PASS  typecheck  (2.2s)
  PASS  effect  (0.3s)
  PASS  tests @zilar/client-core  (1.5s)
  PASS  tests @zilar/mobile  (1.2s)
  PASS  tests @zilar/server  (3.9s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Deviations / notes

- **Tests scope.** The spec allowed at most 2 tests, only for the server or
  client-core. The committed tests follow that (1 server + 1 client-core). The
  real fix is in mobile, so its regression was verified with the temporary
  mobile test described above rather than a committed mobile test. If the lead
  prefers a permanent mobile guard, say so and I will move that test into
  `apps/mobile/src/store/`.
- **Test file split.** `apps/server/src/chats/reads.test.ts` was already exactly
  400 lines (the spec's bar), so the new server test lives in
  `apps/server/src/chats/unread-wake.test.ts` instead of growing that file.
- `apps/mobile/src/lib/chat-api-schemas.ts` (outside Allowed files) still strips
  `deliveredUntil`/`readUntil` from DM entries because its DM struct has no such
  fields; `unread` and `lastMessage` are in the schema, so the fix is complete
  for this bug. Fixing the two mark fields needs a file outside Allowed files.
- After the fix, `apps/mobile/src/lib/topics.ts`'s `summariesForTopicsEntry` is
  no longer called anywhere; that file is outside Allowed files, so it was left
  in place.

### Honesty

I ran every command above; the numbers are the real outcomes. The
phone re-check on Julio's device (acceptance item 3) is the lead's.

## Review (written by Claude)

**Lead, 2026-10-14: approved. Pre-review clean (1 nit, 2 follow-ups); the packet is current for `2741723d`.**
- **The cause is proven:** the mobile DM mapper hard-coded `unread: 0`. It matches the screenshot (the channel had a badge, the DM had none).
- **The server test proves** a delivered mark doesn't affect the count.
- **Follow-ups go to T-1363:** DM rows drop the `readUntil`/`deliveredUntil` marks, and `summariesForTopicsEntry` is now dead code.
- **Still to do:** the phone re-check with the next build.

---
id: T-1287
title: "Shared client fixes: React/Edit/Delete are disabled until a message has a wire id (UI-7); a failed sticker gets status 'failed' like attachments (UI-14); a chat discovered by a refresh is placed by recency with its preview (UI-12); web sign-out calls ledger.reset() (UI-13); tested"
status: merged
milestone: M5
branch: task/T-1287-client-ui-fixes
model: auto
effort: default
depends_on: []
estimate: 0.4 day
---

# T-1287: Shared client fixes from the features audit

## Spec (written by Claude, do not edit)

### Why
`docs/audit/features-ui-audit.md`:
- **UI-7** (P2, `:148`, suspected): react, edit and delete return silently when the bubble has no wire id yet (`packages/client-core/src/store/actions.ts`), so a tap on a still-sending message does nothing.
- **UI-14** (P2, `:155`): a failed sticker is flagged `failed: true` but keeps `status: 'sending'` (`ledger-mutators.ts`), unlike attachments and voice, so the ticks keep the clock.
- **UI-12** (P2, `:178`): a chat that first appears in a refresh goes to the top without a preview, and on the next tick `sortByRecency` sinks it to the bottom.
- **UI-13** (P2, `:195`): web `resetUserState` (`apps/web/src/store/effects/lifecycle.ts`) clears three ledger maps by hand and never calls `ledger.reset()`, which mobile does.
- **UI-8** (`:163`, typed text lost when switching chats) may already be fixed. Check it and report only.

**First recheck each finding on main.** For any already fixed, say so with `file:line` and skip it.

### What to build
1. **UI-7:**
   - add a `canAct(message)` (or `canReact`) selector in chat-core, beside `canEditMessage`, that is false while the wire target is unknown;
   - use it to disable or hide React, Edit and Delete in the web menu (`apps/web/src/components/MessageActionsMenu.tsx`) and the mobile sheet (`apps/mobile/src/components/chat/message-actions-sheet.tsx`).
2. **UI-14:** a failed sticker goes through the same `markSendFailed` path (reason `network`), and its retry through `markSendRetrying`.
3. **UI-12:** insert a newly discovered chat by recency (or load its preview first) so it doesn't jump; fix it in the shared code if both apps share it, otherwise in both apps.
4. **UI-13:** web `resetUserState` calls the ledger's `reset()` and drops the manual clears.
5. **Tests** (the message pipeline), up to 3, in the nearest client-core tests:
   - the UI-14 status;
   - the UI-12 placement;
   - `canAct` false for a message without a wire id.

### Read first
`AGENTS.md`, `docs/audit/features-ui-audit.md` (`:148-200`), `packages/client-core/src/store/actions.ts`, `packages/client-core/src/store/ledger-mutators.ts`, `packages/client-core/src/store/rows.ts` and `apps/web/src/store/effects/lifecycle.ts`.

### Allowed files
`packages/chat-core/src/**/*.ts`, `packages/client-core/src/**/*.ts`, `apps/web/src/store/**/*.ts`, `apps/web/src/components/MessageActionsMenu.tsx`, `apps/web/src/components/message/MessageMenu.tsx`, `apps/mobile/src/store/**/*.ts`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `work/T-1287-client-ui-fixes.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass. Every file stays at most 400 lines.

---

## Report (written by the worker when done)

### Recheck on main
- **UI-7** — present. `react`/`editMessage`/`deleteForEveryone` still return silently when the wire target is undefined (`actions.ts:35`, `:74`, `:142` before this task).
- **UI-14** — present. `markStickerFailed` set only `failed: true` and left `status: 'sending'` (`ledger-mutators.ts:161-163` before this task).
- **UI-12** — present. Both apps inserted new rows with `[...fresh, ...sortByRecency(kept)]` (web `effects/history.ts:229`, mobile `effects/history.ts:211` before this task).
- **UI-13** — present. Web `resetUserState` cleared three ledger maps by hand and never called `ledger.reset()` (`lifecycle.ts:98-102` before this task).
- **UI-8** — **already fixed, skipped.** Web keeps the composer text per chat through `useDraftValue` (`apps/web/src/components/Composer.tsx:77` calls `useDraftValue(chatId)`, implemented in `apps/web/src/components/composer/useDraftValue.ts` over `@/lib/composer-drafts`), so a chat switch no longer loses the draft. Mobile does the same via `useDraftText` (`apps/mobile/src/components/chat/composer.tsx:100`, `use-draft-text.ts` over `lib/composer-drafts`) and the list shows `Draft:` (`chat-list-item.tsx`). No change made.

### What I did
1. **UI-7.** Added `canAct(message)` in `packages/chat-core/src/edits.ts`, beside `canEditMessage`: false while the message has no wire id (still `sending`, or `failed`/`failed === true`). I used the status, not a `local-*` prefix: after the ack the bubble keeps its optimistic id but its status moves to `sent` (`send/context.ts:129-133` `linkSent`, then `updateMessageStatus(..., 'sent')`), so a prefix check would wrongly block a sent-but-not-yet-echoed bubble. The web menu (`MessageMenu.tsx` computes `canAct`, passes `canReact`; `MessageActionsMenu.tsx` disables the reaction buttons and gates Edit/Delete) and the mobile sheet (`message-bubble-actions.tsx` computes `canAct`, gates Edit/Delete and passes `canReact`; `message-actions-sheet.tsx` disables the reaction buttons) now refuse the three actions instead of failing silently.
2. **UI-14.** `send/sticker.ts` now fails through `markSendFailed(chatId, id, 'network')` (core absent, send reject, invalid retry payload) and `retrySticker` moves the bubble back with `markSendRetrying`. Removed the now-dead `markStickerFailed` from `ledger-mutators.ts`/`ledger.ts` and the mobile `StoreHelpers` interface.
3. **UI-12.** Added the shared `orderChatRows(fresh, kept)` in `packages/client-core/src/store/rows.ts` (returns `sortByRecency([...fresh, ...kept])`) and used it in both apps' refresh merge, so a row first seen without a preview sorts with the oldest instead of jumping to the top.
4. **UI-13.** Web `resetUserState` now calls `ctx.k.reset()` (the ledger's own reset, clearing authors, origin ids, base texts, alias chains and server-id links) and drops the three manual clears.
5. **Tests** (3 new, all in client-core): UI-14 status + retry in `send.test.ts`; UI-12 placement in a new `rows.test.ts`; `canAct` false without a wire id in `actions.test.ts`. Also adapted the existing `switchUser.test.ts` fake to give its stub ctx a `k.reset`.

### Files changed
- `packages/chat-core/src/edits.ts`
- `packages/client-core/src/store/rows.ts`, `rows.test.ts` (new), `ledger-mutators.ts`, `ledger.ts`, `send/sticker.ts`, `send.test.ts`, `actions.test.ts`
- `apps/web/src/store/effects/lifecycle.ts`, `effects/history.ts`, `effects/switchUser.test.ts`, `components/MessageActionsMenu.tsx`, `components/message/MessageMenu.tsx`
- `apps/mobile/src/store/effects/history.ts`, `effects/runtime.ts`, `components/chat/message-actions-sheet.tsx`, `components/chat/message-bubble-actions.tsx`
- `work/T-1287-client-ui-fixes.md`

### Commands and results
- `pnpm install` — Done in 1m 21.8s (already installed; reused).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/rows.test.ts src/store/actions.test.ts src/store/send.test.ts` — 3 files, 41 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store/effects/switchUser.test.ts` — 1 file, 1 passed (after fixing the fake).
- `pnpm gate` — **GATE PASS** (18 changed files against main):
  - `PASS install (frozen)  (2.4s)`
  - `PASS format  (1.0s)`
  - `PASS lint  (0.6s)`
  - `PASS typecheck  (3.2s)`
  - `PASS effect  (0.7s)`
  - `PASS tests @zilar/chat-core  (0.8s)`
  - `PASS tests @zilar/client-core  (5.3s)`
  - `PASS tests @zilar/mobile  (2.2s)`
  - `PASS tests @zilar/web  (7.6s)`
  - `scope: every changed file is inside the Allowed files`
  - `migration: every added migration continues from the base`
  - `GATE PASS`

### Deviations / notes
- **Rebase conflict resolved (kept both sides).** `apps/web/src/components/MessageActionsMenu.tsx` conflicted with main's WUX-29 pointer positioning: main's `point` prop, fixed wrapper and viewport clamping were kept together with the UI-7 guard (disabled reaction buttons, `canReact`).
- `canAct` is in `chat-core` as the spec asks, but it is a pure predicate over the message: a pure `chat-core` helper cannot call the store's `wireTargetFor`, so it uses the status, which is the reliable signal for a stored message (see above). Its test therefore lives in `client-core` (`actions.test.ts`), which is where the spec asked for the tests; the selector itself has no `client-core` test file of its own.
- For UI-12, neither app *shared* the merge code (each has its own `refreshChats`/`mergeChatEntries`), so I extracted the ordering into the shared `orderChatRows` helper and used it in both apps, which is also what makes the client-core test meaningful.
- The mobile `message-bubble.tsx` (not in Allowed files) was touched during development and fully reverted; the mobile `canAct` work lives in the allowed `message-bubble-actions.tsx`/`message-actions-sheet.tsx`. `git status` and the gate scope confirm no file outside the list changed.

### Open questions
- None.

### Round (fix round)
- **Findings fixed:** F1 (must-fix). `retrySticker` (`packages/client-core/src/store/send/sticker.ts`) now returns unless the bubble's `status === 'failed'`, matching `retryAttachment`/`retryVoice`, so a second Retry in the same tick cannot fork a second `sendMessage`. F2–F4 are nits and were left as they are (fix-round instruction: do not touch nits outside lines already changed).
- **Tests added:** `a second Retry on the same sticker does not double-send (F1)` in `packages/client-core/src/store/send.test.ts`.
- **Gate:** `pnpm gate` — **GATE PASS** (18 changed files): install, format, lint, typecheck, effect, tests chat-core / client-core / mobile / web all PASS; scope clean; migration check PASS.
- **Disagreements:** none.

## Review (written by Claude)

**Lead, 2026-10-13: approved. Pre-review clean after a conflict round (the `MessageActionsMenu.tsx` conflict with T-1283) and 1 auto round.**
- **The auto round fixed a sticker double-send:** retry now only runs from `failed`, through `markSendRetrying`.
- **UI-8** was already fixed (`useDraftValue`, `apps/web/src/components/Composer.tsx:77`).
- **Lead's checks after the rebase:**
  - client-core vitest: 13 files, 143 tests pass; web `switchUser.test.ts` passes;
  - tsc: 0 errors in web, mobile, client-core and chat-core;
  - the largest touched file is mobile `store/effects/history.ts` at 399 lines.
- **Nit, accepted:** `canAct` still allows group Delete in the ack-to-echo gap.

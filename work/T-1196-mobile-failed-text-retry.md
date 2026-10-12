---
id: T-1196
title: "MUX-3: a failed text on mobile shows a red alert icon and 'Not sent' instead of the sending clock, and its long-press sheet starts with Retry (re-sends with the same id) and Delete (removes the local copy); client-core gets retryText"
status: merged
milestone: M5
branch: task/T-1196-mobile-failed-text-retry
model: auto
effort: default
depends_on: [T-1153, T-1194]
estimate: 0.3 day
---

# T-1196: Failed texts look failed and can be retried on mobile

## Spec (written by Claude, do not edit)

### Why
`docs/audit/mobile-ux-audit.md` MUX-3 (P1, confirmed by code). A text that failed looks exactly like one still sending, and the user has no way to send it again.
- **The same clock for both states:** `apps/mobile/src/components/chat/ticks.tsx:13-15` draws a `Clock` for `sending` **and** `failed`.
- **No failure text:** the text meta (`apps/mobile/src/components/chat/message-bubble-content.tsx:41`, the `Ticks` call) prints none. "Not sent" exists only in `BubbleMeta` for voice and cards (`apps/mobile/src/components/chat/message-bubble-decor.tsx:70-76`).
- **No text retry anywhere:** client-core has `retrySticker`, `retryAttachment` and `retryVoice` (`packages/client-core/src/store/send.ts:28-31`) but no `retryText`. The store does mark a text `failed`: `packages/client-core/src/store/ledger-mutators.ts:98-104`, and since T-1153 also through `outboxFailed` (`packages/client-core/src/store/send/outbox.ts:55`).
- **Mobile can't delete a failed send:** `deleteFailedMessage` (`packages/client-core/src/store/send/failed.ts:4`) exists but isn't wired on mobile.
- **How mobile wires a retry today:** the store type (`apps/mobile/src/store/types.ts:165`), the effect (`apps/mobile/src/store/effects/send.ts:10,33,124`) and the thread (`apps/mobile/src/components/chat/chat-thread.tsx:30,119`).
- **The sheet:** `apps/mobile/src/components/chat/message-actions-sheet.tsx`, mounted from `apps/mobile/src/components/chat/message-bubble-actions.tsx:69`.

### What to build
1. **client-core:** a new `packages/client-core/src/store/send/retry-text.ts` exporting `retryText(ctx, chatId, messageId)`, re-exported from `packages/client-core/src/store/send.ts`.
   - It does nothing unless the message is a failed own text (no attachment, sticker or voice).
   - Otherwise it flips the message back to `sending`: use the mutator at `ledger-mutators.ts:118-124`, and cite it.
   - It re-sends the stored body, reply and mentions **with the same message id**, the way the outbox resend does since T-1153 (`opts.id`, `<origin-id/>`; find the call in `outbox.ts` and cite it), and re-arms the ack timeout and the outbox entry the same way a first send does.
   - Reuse the helpers in `packages/client-core/src/store/send/text.ts`, and export one from there if needed (at most 10 lines changed in `text.ts`).
2. **The mobile store:** add `retryText` and `deleteFailedMessage` to `apps/mobile/src/store/types.ts` and `apps/mobile/src/store/effects/send.ts`, like `retrySticker`.
3. **`ticks.tsx`:** for `failed`, show a lucide `CircleAlert` in the danger colour (find the token the app uses for errors); keep the `Clock` for `sending`.
4. **`message-bubble-content.tsx`:** for an own text with `status === 'failed'`, print "Not sent" in the meta next to the icon, in the same danger colour.
5. **The sheet:** when the message is a failed own text, the first two rows of `message-actions-sheet.tsx` are **Retry** (`RotateCw`) and **Delete** (local only: `deleteFailedMessage`, no confirm). Hide "Delete for everyone" and the forward and edit rows for a failed message.
   - Wire the handlers from `message-bubble-actions.tsx`, reading the two store actions with `useChatStore` the way `chat-thread.tsx:30` does, or passing them down from `chat-thread.tsx`. Pick the shorter path and cite it.
6. **Test** (the message pipeline), 1, in `packages/client-core/src/store/send.test.ts`: a failed text, then `retryText`, goes back to `sending` with the same id, and the core's send is called again once, with that id.

### Read first
`AGENTS.md`, `docs/audit/mobile-ux-audit.md` (MUX-3), `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send/outbox.ts`, `packages/client-core/src/store/send/sticker.ts:100-134` (the retry pattern), `packages/client-core/src/store/ledger-mutators.ts:95-140`, `apps/mobile/src/components/chat/ticks.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx:30-60`, `apps/mobile/src/components/chat/message-actions-sheet.tsx` and `apps/mobile/src/components/chat/message-bubble-actions.tsx`.

### Allowed files
`packages/client-core/src/store/send/retry-text.ts`, `packages/client-core/src/store/send/text.ts`, `packages/client-core/src/store/send.ts`, `packages/client-core/src/store/send.test.ts`, `apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/components/chat/ticks.tsx`, `apps/mobile/src/components/chat/message-bubble-content.tsx`, `apps/mobile/src/components/chat/message-actions-sheet.tsx`, `apps/mobile/src/components/chat/message-bubble-actions.tsx`, `apps/mobile/src/components/chat/chat-thread.tsx`, `work/T-1196-mobile-failed-text-retry.md`.

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The Checks pass.
- Every touched file stays at most 400 lines.
- **The lead's check on the emulator:**
  - send in airplane mode and wait for the failure: a red icon and "Not sent";
  - turn the network back on and press Retry: the text is sent once;
  - Delete removes it.

---

## Report (written by the worker when done)

### What I did
MUX-3: a failed text on mobile now looks failed (red `CircleAlert` + "Not sent"
in the danger colour) and its long-press sheet starts with Retry (re-sends the
stored body with the same id) and Delete (local only, no confirm). client-core
grew `retryText`; the mobile store exposes `retryText` + `deleteFailedMessage`.

- `packages/client-core/src/store/send/retry-text.ts` (new, 140 lines): `retryText(ctx, chatId, messageId)`.
  - No-op unless the message is a failed own text (no attachment, sticker,
    voice or image). Guards mirror `retryAttachment`/`retryVoice` (incl. the
    double-Retry guard: the first click flips to `sending`, the second no-ops).
  - Flips back to `sending` via `markSendRetrying` (`ledger-mutators.ts:118-124`).
  - Re-sends the stored body/mentions/reply with the same message id
    (`opts.id`, `<origin-id/>`; the resend call shape of `outbox.ts:136-159`);
    the reply target is re-resolved to the wire id both sides share (origin id
    in a DM, room stanza-id in a group, like `sendText` does) or dropped when
    unknown. A success/failure re-arms the outbox entry the way a first send
    does (`outboxFailed`, `send/outbox.ts:55`); the ack or the echo settles the
    bubble. No core yet: queues the outbox entry like `sendText`'s no-core path
    (`send/text.ts:47-65`) so the next online flush resends it.
  - 0 lines changed in `text.ts` (no shared helper needed exporting).
- `packages/client-core/src/store/send.ts`: re-export `retryText` (flows to the
  apps via `store/index.ts`'s `export * from './send'`).
- `apps/mobile/src/store/types.ts` + `apps/mobile/src/store/effects/send.ts`:
  added `retryText` and `deleteFailedMessage`, wired like `retrySticker`.
- `apps/mobile/src/components/chat/ticks.tsx`: `failed` shows a lucide
  `CircleAlert` in `DANGER` (`@/lib/colors`, the app's error token); `sending`
  keeps the `Clock`.
- `apps/mobile/src/components/chat/message-bubble-content.tsx`: `BubbleInlineMeta`
  prints "Not sent" in `DANGER` next to the icon for an own failed text (the
  text/meta path; voice and cards already had it in `BubbleMeta`).
- `apps/mobile/src/components/chat/message-actions-sheet.tsx`: with
  `failed`, the first two rows are Retry (`RotateCw`) and Delete (`Trash2`,
  destructive, local only, no confirm); Forward, Select, Edit and
  Delete-for-everyone are hidden. Reply, Copy and Pin stay.
- `apps/mobile/src/components/chat/message-bubble-actions.tsx`: reads
  `retryText`/`deleteFailedMessage`/`currentUserId` with `useChatStore` the way
  `chat-thread.tsx:30` does (passing them down would need `message-list.tsx`
  and `message-bubble.tsx`, outside Allowed files). `chat-thread.tsx`
  untouched.
- `packages/client-core/src/store/send.test.ts`: new test
  `retryText resends a failed text with the same id` (failed via 3 outbox
  flushes, network back, `retryText` -> `sending` with the same id, core send
  called once with `{ id: localId }`).

### Files changed
`packages/client-core/src/store/send/retry-text.ts` (new),
`packages/client-core/src/store/send.ts`,
`packages/client-core/src/store/send.test.ts`,
`apps/mobile/src/store/types.ts`, `apps/mobile/src/store/effects/send.ts`,
`apps/mobile/src/components/chat/ticks.tsx`,
`apps/mobile/src/components/chat/message-bubble-content.tsx`,
`apps/mobile/src/components/chat/message-actions-sheet.tsx`,
`apps/mobile/src/components/chat/message-bubble-actions.tsx`,
`work/T-1196-mobile-failed-text-retry.md`.

### Commands and real results
- `pnpm install`: done, 10.5s.
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts`: 19 passed.
- `pnpm gate` (from repo root): GATE PASS — install, format, lint,
  typecheck, effect, tests @zilar/client-core, tests @zilar/mobile all PASS;
  "every changed file is inside the Allowed files". (First gate run failed on
  `format` for `apps/mobile/src/store/effects/send.ts`; fixed with
  `prettier --write` on that one file, then PASS.)

### Problems / deviations
- Spec item 1 allowed "at most 10 lines changed in `text.ts`": I changed 0 —
  no shared helper needed extracting; the options rebuild lives in
  `retry-text.ts`.
- `send.test.ts` is 588 lines after my +28; it was already 560 before this
  task, so the >400 limit predates me (one focused pipeline test only).
- "Re-arms the ack timeout": texts have no 60 s `armSendTimeout` (only
  voice/attachment/forward do); the ack wait and the outbox entry are what
  bound a text retry, and both are re-armed exactly like a first send.
- UI verified by reading only; the emulator check (airplane-mode Retry/Delete)
  is the lead's acceptance step.

### Security checklist
- No secrets, tokens or message text in logs/audit/errors; fixed "Not sent"
  string only.
- `deleteFailedMessage` (core) only removes a `failed` bubble; retry only
  touches a failed own text in the same chat.
- No new routes, caps, or permissions involved.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Lead, 2026-10-12: approved. The pre-review is clean, with 2 nits and 1 follow-up.**
- **client-core `send/retry-text.ts`:** `retryText` only acts on a failed own text, so a double tap can't double-send.
  - It flips the bubble back to `sending` and resends with **the same stanza id**, so the receiver dedupes on `<origin-id/>`.
  - The reply id is recomputed through `wireTargetFor`, keeping the quote text, and the outbox entry is re-armed like a first send.
- **Mobile:**
  - a red `CircleAlert` for `failed` and "Not sent" in the meta;
  - Retry and Delete (local, `deleteFailedMessage`) at the top of the actions sheet, with "Delete for everyone", forward and edit hidden for a failed message;
  - the store wired like `retrySticker`.
- **Tests:** client-core send 19 of 19, run by the lead.
- **The follow-up:** `send.test.ts` is 588 lines. Tests are exempt from the 400-line limit, so splitting it is optional.
- **Still to do:** the emulator check, after T-1197 (airplane mode, the failure, Retry and Delete).

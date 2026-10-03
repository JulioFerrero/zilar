---
id: T-0168
title: A failed voice or attachment send shows "Not sent" with Retry, never a clock forever
status: review
milestone: M5
branch: task/T-0168-send-failure-state
model: meta/muse-spark-1.3-contributor
effort: medium
depends_on: [T-0166]
estimate: 0.5 day
---

# T-0168: A failed voice or attachment send shows "Not sent" with Retry

## Spec (written by Claude, do not edit)

### Why
On the live install a voice message stayed on the clock forever. The cause was a server image without ffmpeg (fixed separately), but the app made it worse: `sendVoice` in `apps/web/src/store/realStore.ts` swallows every error (`catch {}` with the comment "stays sending") and `MessageStatus` has no failure value (`packages/chat-core/src/types.ts`: `'sending' | 'sent' | 'read'`). Any upload, conversion or network failure, for voice or for attachments, looks like "still sending" and the person cannot tell, retry or remove it.

### What to build
1. **Status.** Add `'failed'` to `MessageStatus`. A failed message keeps its local blob/file so it can be retried. `advanceStatus` must never move `failed` to `sending` by accident, only an explicit retry may.
2. **Voice and attachment sends** (`sendVoice`, `sendAttachment` and their stickers/GIF siblings only if they share the same catch pattern): when conversion, upload or the final send throws, set the message to `failed` and remember the reason in a small field (a fixed, user-safe string chosen from the error class: too large, unsupported file, server unavailable, upload refused, network). Never put raw error text or URLs into the UI or logs.
3. **UI.** A failed own message shows a red "Not sent" label with the reason, a **Retry** button and a **Delete** button (removes the local bubble). Retry re-runs the same pipeline from the retained blob and moves the bubble back to `sending`; success moves it to `sent` as today. Keyboard reachable, with accessible names.
4. **Timeout.** A send that neither succeeds nor fails within 60 seconds is marked `failed` with the reason "Timed out", so a hung request cannot sit on the clock either (cancel the pipeline with an AbortController where the ports allow it, otherwise ignore its late result).
5. **Mobile and shared types.** Adding the union member must not break the mobile app's typecheck: where mobile switches on `MessageStatus`, treat `failed` like `sending` plus a plain "Not sent" text, nothing more (a full mobile UI is a later task).
6. Tests (Vitest, Testing Library): conversion failure, upload failure and final-send failure each end in `failed` with the right reason; Retry succeeds and ends in `sent`; Delete removes the bubble; timeout; no raw error text appears; `advanceStatus` rules.

### Read first
`AGENTS.md`, `packages/chat-core/src/types.ts`, `apps/web/src/store/realStore.ts` (`sendVoice`, `sendAttachment`, `updateMessageStatus`, `advanceStatus`), `apps/web/src/lib/voice.ts`, the message bubble components that show the clock, `apps/mobile` usages of `MessageStatus`.

### Allowed files
`packages/chat-core/src/types.ts` and its tests, `apps/web/src/store/**`, the web message bubble and status components and their tests, the minimal `apps/mobile` lines needed to keep the typecheck green, `work/T-0168-send-failure-state.md`. No server changes, no new dependencies.

### Checks
```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @zilar/web test --maxWorkers=2 src/store src/components src/lib/voice
pnpm --filter @zilar/chat-core test --maxWorkers=2
```

### Acceptance
- A voice message whose conversion fails ends as "Not sent: server unavailable" (or the matching reason), with Retry and Delete; Retry after the cause is fixed sends it.
- No send path in voice or attachments can stay on the clock for more than 60 seconds.
- Mobile typecheck passes.

### Out of scope
Text message retry and offline queueing, a full mobile failure UI, automatic retries.

---

## Report (written by the worker when done)

### What I did
Gave voice and attachment sends a real failure state instead of a clock forever:
- `packages/chat-core/src/types.ts`: added `'failed'` to `MessageStatus` and a new
  `SendFailureReason` union (`too_large | unsupported_file | server_unavailable |
  upload_refused | network | timed_out`) plus an optional `failureReason` on
  `UiMessage`. New `packages/chat-core/src/failures.ts` maps each reason to one
  fixed user-safe label (`sendFailureLabel`).
- `apps/web/src/store/realStore.ts`:
  - `advanceStatus` never moves into or out of `failed` (only an explicit retry does,
    via new `markSendRetrying`); the echo reconcile in `handleMessage` therefore
    cannot downgrade a failed bubble (`{...ui, status: advanceStatus(...)}`).
  - New `markSendFailed` (bubble + list preview leave `sending` for `failed` with a
    reason, keeping local bytes; mirrors the legacy `failed` flag), `removeFailedMessage`
    (drops only a `failed`-status local bubble and falls the preview back to the
    previous message), `sendFailureReasonFor` (error class / HTTP status / offline
    only — never raw text or URLs), and a per-attempt 60 s `SEND_TIMEOUT_MS` deadline
    (`armSendTimeout`/`settleSendTimeout` with a run token, cleared on `stop()`).
  - `sendVoice` pipeline extracted to re-runnable `runVoiceSend`; recording bytes are
    kept in `pendingVoices` until the stanza send succeeds (echo also drops them).
    New actions `retryVoice` and `deleteFailedMessage`. `runAttachmentUpload` and
    `retryAttachment` use the same failure/timeout path (GIF sends go through
    `sendAttachment`, so they are covered; stickers keep their existing flag-only path).
- UI (`apps/web`): `MessageTicks` renders a red alert with accessible name "Not sent"
  for `failed`; `MessageBubble` renders a `SendFailure` row under a failed own voice /
  attachment bubble ("Not sent: <reason>", Retry, Delete — all keyboard-reachable
  buttons with accessible names). Legacy `failed`-flag-without-status rows are kept
  for older bubbles.
- `apps/web/src/store/store.ts`: interface entries plus mock-store behavior (retry
  clears back to `sending`, delete drops the bubble) so the UI is exercisable.
- `apps/mobile` (minimal, typecheck + spec item 5): `STATUS_RANK` accepts `failed`
  (same closed-ladder rule), `Ticks`/`outgoingTicks` treat `failed` like `sending`,
  and `BubbleMeta` shows a plain "Not sent" text on failed own messages.

### Files changed
`packages/chat-core/src/types.ts`, `packages/chat-core/src/failures.ts` (new) +
`failures.test.ts` (new) + `index.ts` export, `apps/web/src/store/realStore.ts`,
`apps/web/src/store/store.ts`, `apps/web/src/store/realStore.test.tsx` (updated 1
old-behavior assertion, new T-0168 suite), `apps/web/src/components/MessageBubble.tsx`,
`MessageTicks.tsx`, `SendFailure.test.tsx` (new), `apps/mobile/src/store/real-store.ts`,
`apps/mobile/src/components/chat/ticks.tsx`,
`apps/mobile/src/components/chat/message-bubble.tsx`.

### Commands and real results
- `pnpm install`: ok (1049 packages).
- `pnpm format:check`: pass.
- `pnpm lint`: pass, no warnings.
- `pnpm typecheck` (turbo, all 11 tasks incl. `@zilar/mobile`): pass.
- `pnpm --filter @zilar/chat-core test --maxWorkers=2`: 11 files, 136 passed.
- `pnpm --filter @zilar/web test --maxWorkers=2 src/store src/components src/lib/voice`:
  69 files, 759 passed (incl. 12 T-0168 store tests + 4 SendFailure UI tests).
- Targeted re-run after final edits (`realStore`, `SendFailure`, `AttachmentBubbles`,
  `StickerPanel`): 4 files, 157 passed.

### Review round 1 (findings 1-5 fixed, 6-7 acknowledged)
- Finding 1: `retryAttachment` now returns early unless the bubble's status is
  `failed` (same guard as `retryVoice`); new test double-clicks Retry and asserts
  `upload` ran exactly twice total (1 initial + 1 retry) and the bubble ends `sent`.
- Finding 2: new `isCurrentSendRun` guard wraps every pipeline continuation — stale
  run's success (status update, timer settle, bytes drop) and failure
  (`markSendFailed`) are ignored once a retry owns the message.
- Finding 3: a server echo that consumes the local id now promotes the bubble to
  `sent` via new `clearSendFailure` (failure flags dropped) and drops the kept bytes;
  the old late-echo test now asserts end state `sent` with no Retry, renamed to
  `a server echo for a failed-but-delivered send marks it sent with no Retry`.
  `advanceStatus` still blocks any later `sending`/`failed` downgrade.
- Finding 4: renamed the timeout test to `a hung voice send is marked timed_out
  after 60 s` (the hanging promise never settles there) and added two late-result
  variants: stale reject after timeout+retry (stays `sending`, retry then `sent`) and
  stale resolve after timeout+retry (stays `sending`, preview agrees).
- Finding 5 (nit): removed the unreachable `core === undefined` argument — both catch
  blocks now pass `false` (early return above guarantees a core).
- Findings 6-7: stickers unchanged (out of scope, confirmed); `failures.ts` kept.

### Problems / deviations
- Existing test `marks a failed upload failed and retries it` asserted
  `status: 'sending'` on failure; updated to `status: 'failed'` + `failureReason:
  'upload_refused'` + back-to-`sending` on retry (the intended spec change).
- Sticker sends keep their old flag-only failure path (separate `markStickerFailed`,
  not the shared catch the spec conditions on) — out of scope, untouched.
- No AbortController: neither `VoicePort` nor `AttachmentPort` accepts a signal, so
  the timeout marks `failed` and ignores the late result instead of cancelling the
  request (allowed by the spec's "otherwise ignore its late result"). Widening the
  ports would touch shared lib signatures owned by other tasks.
- `canEditMessage` already excludes voice/attachment payloads only via `text ===
  undefined` for voice (voice messages carry no text) — a failed voice bubble has no
  text so Edit stays hidden; failed attachments with captions keep the text-edit path
  (edits the caption, pre-existing behavior).

### Security checklist
- Reasons are fixed buckets from error class/HTTP status/offline; tests assert raw
  messages, URLs and tokens never reach the stored message or UI.
- `removeFailedMessage`/`deleteFailedMessage` only touch messages with
  `status === 'failed'` in the named chat; nothing is sent on delete (the stanza never
  went out, so no retraction needed).
- No new routes, no caps, no audit entries, no secrets in logs.

### Open questions
None.

## Review (written by Claude)

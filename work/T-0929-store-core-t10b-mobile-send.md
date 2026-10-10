---
id: T-0929
title: "Store core T10b: the mobile store on the core send pipeline (R6 deadline, R18 sticker retry, R20 banner), mobile's message shape and inline validation kept, tests first"
status: merged
milestone: M5
branch: task/T-0929-store-core-t10b-mobile-send
model: auto
effort: default
depends_on: [T-0922, T-0933]
estimate: 1 day
---

# T-0929: Store core T10b, mobile send on the core

## Spec (written by Claude, do not edit)

### Why
T-0922 (merged) moved the send pipeline into `packages/client-core/src/store/send.ts`, with `send-failure.ts`, and bound web to it. It stopped under its split rule, so mobile is still on its own `apps/mobile/src/store/effects/send.ts` (708 lines). Read T-0922's Report and Review first.

What the core already carries:
- **R6:** the 60 s deadline (`SEND_TIMEOUT_MS` at `send.ts:34`); a hung upload ends with `timed_out`.
- **R18:** `retrySticker` (`:728`) does not re-enqueue the signature.
- **R20:** a stale `actionError` clears on the next send.
- **Ports:** `bytes` and `voice` live in `SendPorts` (`packages/client-core/src/store/ports.ts:158`), with `OutgoingBytes` `:123`, `VoiceInput` `:136` and `VoiceOut` `:144`.

What mobile must keep (the lead read main on 2026-10-10):
- **The failed-message shape.** The mobile screens read `message.failed === true`:
  - `apps/mobile/src/components/chat/attachment-body.tsx:51-52`;
  - `apps/mobile/src/components/chat/voice-message.tsx:152-153`;
  - `apps/mobile/src/components/chat/message-bubble.tsx:370`.

  The mobile adapter maps the core's failure to `failed: true` plus `failureReason`. The screens are not edited.
- **The plain-text option shape.** Mobile sends `undefined` options for plain text: `apps/mobile/src/store/real-store.mentions.test.ts:162` pins `xmpp.sent` to `[undefined]`. Web pins `{}`. Keep both, through a `SendCtx` option or the mobile facade.
- **R19:** the inline validation banners (empty or too large file, bad recording) stay in the mobile facade.

### What to build
1. **Tests (Julio's 10-10 rule: only crucial ones, no "tests first"):** a new `apps/mobile/src/store/real-store.send.test.ts` holds exactly three tests:
   - a text send is echoed once;
   - **R6:** a hung attachment upload ends `failed: true` with a reason within 60 s (fake timers);
   - **R18:** after a failed sticker send, a later identical sticker's echo links to the right bubble.
2. **Mobile ports:** `apps/mobile/src/store/effects/ports.ts` maps the uploader (`:43`), `statSize` (`:50`) and voice (`:52`) to the core `SendPorts`.
3. **Mobile binding:** `apps/mobile/src/store/effects/send.ts` keeps its validation and binds the core pipeline. In `apps/mobile/src/store/real-store.ts`:
   - `forwardOriginFor` (`:379`) and the upload-progress mutator (around `:312`) move to the core where they match web's;
   - otherwise only the wiring changes.
4. **T-0922's nits:**
   - `bytes.describe` runs once per image send (`send.ts:234` and `:572`).
5. **Behaviour:** R6 and R18 on mobile only, listed in the Report. Another test may be edited only where the move breaks it; delete it instead if it is not crucial.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use `apps/mobile/src/test/wait.ts`, never a raw `setTimeout(resolve, 0)`), the Report and Review of `work/T-0922-store-core-t10-send.md`, `packages/client-core/src/store/send.ts`, `send-failure.ts` and `ports.ts` with their tests, `apps/mobile/src/store/effects/send.ts` with its tests, and `apps/mobile/src/store/effects/ports.ts`.

### Allowed files
`packages/client-core/src/store/send.ts`, `packages/client-core/src/store/send.test.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/index.ts` (T10 section only), `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store.send.test.ts`, `work/T-0929-store-core-t10b-mobile-send.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm gate
```
The lead runs the phone smoke.

### Acceptance
- The Checks pass.
- The Report gives the lines per side and lists R6 and R18.
- Live check for Julio on the phone:
  - send text, a sticker, a photo, voice and a forward;
  - turn the network off during an upload: "Not sent" appears within 60 s, then retry;
  - an empty-file banner still shows.

---

## Report (written by the worker when done)

Status: review. Branch `task/T-0929-store-core-t10b-mobile-send`. The mobile send pipeline now runs on the core `packages/client-core/src/store/send.ts`; the mobile store keeps only its inline validation (R19), its cancel actions and its local preview.

### Behaviour changed / kept, listed

- **R6:** a mobile attachment or voice send gets the core's 60 s deadline (`SEND_TIMEOUT_MS`); a hung upload ends with the bubble `failed: true` and `failureReason: 'timed_out'` (within 60 s). New mobile test "marks a hung attachment upload failed within 60 s (R6)".
- **R18:** `retrySticker` no longer re-enqueues the sticker signature (the core rule), so after a failed first send a later identical sticker's echo links to the right bubble. New mobile test "links a later identical sticker echo to the right bubble after a failed send (R18)".
- **R20** (already shared in the core, no new work): a stale `actionError` clears on the next validated send; the core covers sticker/attachment/voice and `retrySticker`.
- **R19** (kept, not moved): mobile's inline banners stay in `effects/send.ts` — empty file ("That file is empty."), oversized file ("That file is larger than 50 MB.") and a bad recording (`voiceSendRefusalMessage`). Web keeps its silent return.
- **Mobile message shape kept:** the core's failure is `failed: true` + `failureReason` on the message, exactly what `attachment-body.tsx`, `voice-message.tsx` and `message-bubble.tsx` read (screens untouched).
- **Plain-text option shape kept:** mobile still sends `undefined` options for a plain text, web still sends `{}` (see deviations).
- **Text (D-1):** a failed text still stays `sending` (core behaviour, unchanged).
- **Mobile-only things kept:** upload progress (`uploadProgress`), the local preview (`localUri`) and `cancelAttachment` / `cancelVoice`.

### Files changed (lines per side, `git diff --numstat` + new file)

- **Core:** `packages/client-core/src/store/send.ts` **+100 / −24**.
  - `bytes.describe` runs once per send: `sendAttachment` describes once and passes the result into `runAttachmentUpload`; `retryAttachment` describes once too (T-0922 nit).
  - Upload progress moved into the core (`setUploadProgress` / `clearUploadProgress`) and wired to the ports' `onProgress`; web's port ignores `onProgress`, so web is unchanged.
  - New optional `SendCtx.omitEmptyTextOptions`, used by `sendText` (see deviations).
  - `ctx.ts` / `index.ts` / `send.test.ts`: untouched (not needed).
- **Mobile:** `apps/mobile/src/store/effects/send.ts` **+110 / −635** (708 → ~180 lines, now a binding: core pipeline + R19 + cancel + `localUri`); `effects/ports.ts` **+104 / −8** (builds the core `bytes` and `voice` ports from the uploader, `statSize` and the voice port); `effects/runtime.ts` **+6 / −7** (`StoreState` gains `sequence` + `sendRuns`; `StoreHelpers` drops `setUploadProgress`, `clearUploadProgress`, `forwardOriginFor`, `forwardedPayloadFor`, `forwardedUiFieldsFor`); `real-store.ts` **+7 / −82** (`forwardOriginFor`/`forwardPublicRoomFor` deleted — the core has them; upload-progress mutators deleted — now core; wiring only otherwise); new `real-store.send.test.ts` **+221** (exactly three tests).
- `work/T-0929-store-core-t10b-mobile-send.md` **+1 / −1** (status).

### Deviations from the spec (with reasons)

- **`omitEmptyTextOptions` is a new `SendCtx` field.** The spec allows "a `SendCtx` option or the mobile facade" to keep mobile's `undefined` plain-text options while web keeps `{}`. `apps/mobile/src/store/effects/send.ts` sets it `true`; web leaves it unset, so `{}` is the default and the core test that pins `{}` still passes.
- **The upload-progress mutators moved into `core/send.ts`** (the spec's real-store line says they move to the core). They write `uploadProgress` on the message, which the mobile UI reads; web's `bytes` port ignores `onProgress`, so nothing changes there. I did not add them to the ledger (out of the Allowed files).
- **`bytes` and `voice` live on mobile's `PortsShape`, not on `CorePorts`.** Adding required fields to `CorePorts` would force web's adapter shape too; mobile's `SendCtx` combines `coreCtx.ports` with these two.
- **`bytes.cancel` was not added to the mobile `bytes` port.** Mobile's `cancelAttachment` / `cancelVoice` stay in the facade and call `ports.uploader.cancel`, as before; the core never calls `bytes.cancel`.
- **`localUri` is set by the binding after the core inserts the optimistic message** (the core builds the bubble, so the binding keys it by the `local-N` id the core just minted). Keeps the mobile local preview and the kept `real-store.ledger.test.ts` expectation intact.
- **No other test was edited.** The kept `apps/mobile/src/store/effects/send.test.ts` (3 tests) and `real-store.ledger.test.ts` still pass unchanged.

### Commands and real results

- `pnpm install` — 1172 packages, done in 17.1s.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.send.test.ts` — **3 passed** (the new file).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts` — **11 passed**.
- `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store` — **7 files, 38 passed**.
- `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot src/store` — **7 files, 41 passed** (the core change does not break web's binding).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot` — **7 files, 72 passed**.
- `pnpm gate` (repo root, final) — **GATE PASS**:
  - `gate: 7 changed file(s) against main`
  - `PASS  install (frozen)  (5.6s)`
  - `PASS  format  (3.2s)`
  - `PASS  lint  (2.4s)`
  - `PASS  typecheck  (6.5s)`
  - `PASS  effect  (2.1s)`
  - `PASS  tests @zilar/client-core  (2.6s)`
  - `PASS  tests @zilar/mobile  (5.3s)`
  - `scope: every changed file is inside the Allowed files`
- (An earlier gate run failed only on `format` for two files; fixed with `prettier --write` on those two, then it failed only on the `effect` ratchet for a raw `try` in `send.ts`; restored the file's existing `Effect.runSync(Effect.try(...))` validation pattern, then `GATE PASS`.)

### Live check for Julio (phone; the lead runs the smoke)

Unchanged from the spec: send text, a sticker, a photo, voice and a forward; turn the network off during an upload — "Not sent" appears within 60 s, then retry works; an empty-file banner still shows.

### Open questions

- None. The only judgement call is the `omitEmptyTextOptions` name and the progress mutators living in `core/send.ts`; both are listed above.

### Round 2 (pre-review fixes)

- **Finding 1 (must-fix), cancel no longer stops the pipeline:** fixed in `packages/client-core/src/store/send.ts` and `apps/mobile/src/store/effects/send.ts`.
  - `core/send.ts`: a new `messageAlive(ctx, chatId, localId)` guard stops `runAttachmentUpload` after the slot/PUT and `runVoiceSend` after `convert` and after the upload, before anything reaches `sendMessage`; the early return also settles the run. A new exported `disarmSend(ctx, messageId)` cancels the keyed 60 s watcher and drops the run token; `deleteFailedMessage` now calls it.
  - `effects/send.ts`: `cancelAttachment` and `cancelVoice` call `disarmSend(sendCtx, messageId)` before removing the bubble, so a pipeline still awaiting its convert/slot/PUT sees the bubble gone and sends nothing.
- **Finding 2 (nit), offline voice failure copy:** left as is. It is a nit (not must-fix/should-fix), and the rules say not to touch nits outside a line already changed; `settleFailure`'s `sendFailureReasonFor(cause, false)` was not otherwise part of this fix. No disagreement with the finding — it is correct.
- **Tests added** in `apps/mobile/src/store/real-store.send.test.ts` (1 file, now 5 tests):
  - "does not deliver a photo cancelled while its upload is in flight": a hung `uploader.upload` is resolved after `cancelAttachment`; asserts `sendMessage` was never called and no bubble remains.
  - "does not deliver a voice note cancelled while it converts": a hung voice `convert` is resolved after `cancelVoice`; asserts neither `upload` nor `sendMessage` ran.
- **Commands and real results:** `pnpm --filter @zilar/mobile test --maxWorkers=2 --reporter=dot src/store/real-store.send.test.ts` — 1 file, 5 passed; `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts` — 1 file, 11 passed; `pnpm gate` (repo root) — **GATE PASS** (install, format, lint, typecheck, effect, tests @zilar/client-core, tests @zilar/mobile; scope: every changed file is inside the Allowed files).
- **Disagreements:** none.

## Review (written by Claude)

**Lead, 2026-10-10: approved. Clean after 1 automatic round, with 2 nits.**
- **The move:** mobile sends run on the core pipeline. Mobile `effects/send.ts` went from 708 to about 180 lines, and keeps R19 validation, cancel and `localUri`. `effects/ports.ts` builds the core `bytes` and `voice` ports.
- **Behaviour:**
  - R6: a hung attachment or voice upload ends `failed: true`, `timed_out` within 60 s;
  - R18: a sticker retry no longer re-enqueues its signature.
- **Kept as before:** the mobile message shape (the screens are untouched), and plain text keeps `undefined` options (`omitEmptyTextOptions` on `SendCtx`).
- **Round 1 fix:** cancel disarms the send pipeline.
- **Tests:** 5 in the new `real-store.send.test.ts` (3 asked, plus 2 cancel tests from round 1).
- **Follow-up:** `deleteFailedMessage` (`packages/client-core/src/store/send.ts:641`) drops `pendingVoices` but not `pendingAttachments`, so a deleted failed attachment keeps its bytes in memory until reload.
- **Phone smoke:** passes, with the chat list and folder chips shown.
- **Live check for Julio on the phone:** send text, a sticker, a photo, voice and a forward; turn the network off during an upload: "Not sent" appears within 60 s, then retry.

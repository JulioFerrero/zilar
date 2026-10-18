---
id: T-2054
title: "Share W3-e (message pipeline): core sendAttachment/sendVoice return the optimistic message id they minted (undefined when refused), so the phone stops guessing `local-${sequence}` for its file:// preview, and the phone's two identical cancel paths (attachment, voice) become one helper — with a core test"
status: merged
milestone: M5
branch: task/T-2054-send-minted-id-and-cancel
model: deepseek/deepseek-flash
effort: default
estimate: 30 min
---

# T-2054: Return the minted send id, one cancel path (share plan W3-e)

## Spec (written by Claude, do not edit)

### Why
`docs/audit/share-plan.md` §4 (send row) found two problems on the phone:
- **A guessed id.** The phone keys its `file://` preview by **guessing** the id the core minted (`local-${s.sequence}`). That breaks silently if the core's id rule changes.
- **A doubled cancel.** It writes the same 6-step cancel twice, once for attachments and once for voice.

This is the message pipeline, so a core test is required.

### Facts (read by the lead on 2026-10-18 at `13819b0fd`)
- **The core.**
  - `packages/client-core/src/store/send/attachment.ts:139-149`: `sendAttachment(ctx, chatId, file, options): void`, which returns early when the chat is unknown and then mints `const localId = nextLocalId(ctx)`.
  - `packages/client-core/src/store/send/voice.ts:115-125`: `sendVoice`, the same shape.
  - `nextLocalId` (`packages/client-core/src/store/send/context.ts:54-56`) returns `` `local-${ctx.sequence}` ``.
  - Core tests are in `packages/client-core/src/store/send.test.ts`, with `describe('sendAttachment (core)')` at `:762`.
- **Web callers.** Web calls both through `apps/web/src/store/effects/send.ts:11,14,40` and `chatActions.ts:195,204`, and ignores the result. A `void` → `string | undefined` change is safe there.
- **Phone.** `apps/mobile/src/store/effects/send.ts` (206 lines):
  - `markLocalUri(chatId, uri, before)` (`:97-109`) guesses `` `local-${s.sequence}` ``. It's called after `sendAttachmentCore` (`:143-145`) and `sendVoiceCore` (`:182-189`).
  - `cancelAttachment` (`:147-159`) and `cancelVoice` (`:191-204`) are identical except for `s.pendingUploads` against `s.pendingVoices`.

### Steps
1. **Core.** `sendAttachment` and `sendVoice` return `string | undefined`: the minted `localId`, or `undefined` on every early return. No other behaviour change.
2. **Core test.** Add one test in `send.test.ts`, next to `:762`: the id `sendAttachment` returns equals the id of the optimistic message it inserted for that chat. Add one test for `sendVoice` as well.
3. **Phone.**
   - `markLocalUri(chatId, messageId, uri)` takes the returned id, does nothing when it is `undefined`, and the sequence guess is deleted.
   - One local `cancelSend(chatId, messageId, pending: Map<string, unknown>)` holds the 6 steps (both `uploader.cancel` calls, both deletes, `disarmSend`, `removeBubble`), keeping the comment. `cancelAttachment` and `cancelVoice` call it with their map.
4. **Web.** No change. Report the line counts.

### Allowed files
- `packages/client-core/src/store/send/attachment.ts`
- `packages/client-core/src/store/send/voice.ts`
- `packages/client-core/src/store/send.test.ts`
- `apps/mobile/src/store/effects/send.ts`
- `work/T-2054-send-minted-id-and-cancel.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/store/send.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- **Lead check, phone emulator:** sending a photo shows its preview at once.

---

## Report (written by the worker when done)

### What I did

- **Core.** `sendAttachment` (`packages/client-core/src/store/send/attachment.ts`) and
  `sendVoice` (`packages/client-core/src/store/send/voice.ts`) now return
  `string | undefined`: the minted `localId` on success, `undefined` on the unknown-chat
  early return. No other behaviour changed.
- **Core tests.** Added one test to `describe('sendAttachment (core)')` and one to
  `describe('sendVoice (core)')` in `packages/client-core/src/store/send.test.ts`. Each
  asserts the returned id equals the optimistic message's id for that chat and that an
  unknown chat returns `undefined`.
- **Phone.** `apps/mobile/src/store/effects/send.ts`:
  - `markLocalUri(chatId, messageId, uri)` now takes the id the core returned, returns
    when it is `undefined`, and the `local-${sequence}` guess plus the `before` capture
    are gone.
  - One local `cancelSend(chatId, messageId, pending)` holds the 6 steps (both
    `uploader.cancel` calls, both deletes, `disarmSend`, `removeBubble`) and keeps the
    cancel comment. `cancelAttachment` and `cancelVoice` are one-line calls with their
    map (`s.pendingUploads` / `s.pendingVoices`).
  - Net effect: `apps/mobile/src/store/effects/send.ts` went from 206 to 194 lines.
- **Web.** No change, as specified. Line counts: `apps/web/src/store/effects/send.ts`
  is 109 lines, `apps/web/src/store/effects/chatActions.ts` is 256 lines; its two calls
  (`sendVoice` at `:195`, `sendAttachment` at `:204`) ignore the return value, so
  `void` → `string | undefined` is source-compatible.
- Files changed: the three core files, the mobile binding and this task file. All inside
  Allowed files.

### Checks run

- `pnpm install`: done in 25.1s (only the existing `@types/react` peer warning).
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/store/send.test.ts`:
  1 file passed, 34 tests passed (`Test Files 1 passed (1)`, `Tests 34 passed (34)`).
- `pnpm gate`: the first run failed on `format` for
  `apps/mobile/src/store/effects/send.ts`; fixed it with
  `pnpm exec prettier --write apps/mobile/src/store/effects/send.ts` and re-ran the gate,
  which ended with:

```
gate: 5 changed file(s) against main
PASS  install (frozen)  (1.6s)
PASS  format  (0.9s)
PASS  lint  (1.1s)
PASS  typecheck  (4.9s)
PASS  effect  (1.6s)
PASS  build @zilar/server  (0.6s)
PASS  tests @zilar/client-core  (2.8s)
PASS  tests @zilar/mobile  (4.5s)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```

### Notes for the lead

- The phone emulator check (sending a photo shows its preview at once) was not run; it is
  the lead's check. The code path is now the returned core id instead of the sequence
  guess, and the core test pins that id.
- No deviations from the spec. The tests also cover the `undefined`-when-refused arm
  named in the task title, in the same two tests.
- No new dependencies.

## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.**
  - Core `sendAttachment` and `sendVoice` return the minted `local-N` id, or undefined when refused. Two new core tests prove it is the inserted bubble's id.
  - The phone keys its `file://` preview by that id instead of guessing `local-${sequence}`, and one `cancelSend` replaces the two copies.
- **Size.** −12 product lines.
- **Not done:** the spec's emulator check. The mock attach flow needs the gallery picker, and the preview is keyed by the same id as before. The core tests cover the id.

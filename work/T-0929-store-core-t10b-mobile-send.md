---
id: T-0929
title: "Store core T10b: the mobile store on the core send pipeline (R6 deadline, R18 sticker retry, R20 banner), mobile's message shape and inline validation kept, tests first"
status: todo
milestone: M5
branch: task/T-0929-store-core-t10b-mobile-send
model: auto
effort: default
depends_on: [T-0922]
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
1. **Tests first,** committed on the old code, in a new `apps/mobile/src/store/real-store.send.test.ts`.
   - Guards: a text send with its echo; a sticker; an attachment with upload progress; voice; forward; a failed attachment with its reason; retry; delete; and the inline banner for an empty file.
   - Then one failing commit with the new expectations:
     - **R6:** a hung attachment upload and a hung voice upload end `failed: true` with a reason within 60 s (fake timers);
     - **R18:** two failed sticker sends, then a later identical sticker's echo links to the right bubble.
2. **Mobile ports:** `apps/mobile/src/store/effects/ports.ts` maps the uploader (`:43`), `statSize` (`:50`) and voice (`:52`) to the core `SendPorts`.
3. **Mobile binding:** `apps/mobile/src/store/effects/send.ts` keeps its validation and binds the core pipeline. In `apps/mobile/src/store/real-store.ts`:
   - `forwardOriginFor` (`:379`) and the upload-progress mutator (around `:312`) move to the core where they match web's;
   - otherwise only the wiring changes.
4. **T-0922's nits:**
   - `bytes.describe` runs once per image send (`send.ts:234` and `:572`);
   - add a core test that `retrySticker` clears the banner.
5. **Behaviour:** R6 and R18 on mobile only, listed in the Report. No existing test is edited.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use `apps/mobile/src/test/wait.ts`, never a raw `setTimeout(resolve, 0)`), the Report and Review of `work/T-0922-store-core-t10-send.md`, `packages/client-core/src/store/send.ts`, `send-failure.ts` and `ports.ts` with their tests, `apps/mobile/src/store/effects/send.ts` with its tests, and `apps/mobile/src/store/effects/ports.ts`.

### Allowed files
`packages/client-core/src/store/send.ts`, `packages/client-core/src/store/send.test.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/index.ts` (T10 section only), `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store.send.test.ts`, `work/T-0929-store-core-t10b-mobile-send.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store src/components/chat
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/client-core typecheck
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the store tests 3 times. The lead runs the phone smoke.

### Acceptance
- The Checks pass, 3 runs.
- The test commits come before the move.
- No existing test is edited.
- The Report gives the lines per side and lists R6 and R18.
- Live check for Julio on the phone:
  - send text, a sticker, a photo, voice and a forward;
  - turn the network off during an upload: "Not sent" appears within 60 s, then retry;
  - an empty-file banner still shows.

---

## Report (written by the worker when done)

## Review (written by Claude)

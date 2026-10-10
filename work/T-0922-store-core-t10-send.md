---
id: T-0922
title: "Store core T10: the send pipeline (text, sticker, attachment, voice, forward; failure, deadline, retry) in packages/client-core, both stores on it, tests first (Q2, Q4)"
status: todo
milestone: M5
branch: task/T-0922-store-core-t10-send
model: auto
effort: default
depends_on: [T-0918]
estimate: 1.5 day
---

# T-0922: Store core T10, the send pipeline

## Spec (written by Claude, do not edit)

### Why
This is task T10 of `docs/STORE_CORE_PLAN.md` (section 6, "T10: the send pipeline in core (core + web + mobile), tests first, live"), the last task of the split. Its risk is high.

The lead re-checked the files on main on 2026-10-10:
- `apps/web/src/store/effects/send.ts` (722 lines) and `effects/sendFailure.ts` (70);
- `apps/mobile/src/store/effects/send.ts` (708);
- mobile `apps/mobile/src/store/real-store.ts`: `forwardOriginFor` at `:379`, and the upload-progress mutators around `:312-332`.

Behaviour rows (plan section 2.3) and the lead's decisions (section 8):
- **R6 (Q2 = yes):** a mobile voice message, attachment or forwarded copy that fails or hangs shows "Not sent" with the reason within 60 s, as on web. Web has the deadline and run tokens in `send.ts`.
- **R18:** after a failed sticker, a retry must not leave a stale second echo entry. Mobile enqueues the signature again today.
- **R19:** keep each app's input validation in its own facade: web returns silently on a size-0 file, and mobile shows an inline banner.
- **R20 (Q4 = yes):** a stale error banner clears on the next send, on web too, as mobile does.
- **D-1:** text sends keep their current behaviour; a failed text stays "sending".

### What to build
1. **Tests first,** committed on the old code:
   - web: a new `apps/web/src/store/realStore.send.test.tsx`;
   - mobile: a new `apps/mobile/src/store/real-store.send.test.ts`;
   - what must not change: text send and echo, a sticker, an attachment with upload progress, voice, forward, a failed send with its reason, retry, and delete;
   - then one failing commit with the new expectations:
     - R18: two failed sticker sends, then a later identical sticker links to the right bubble;
     - R6: a mobile hung upload ends "Not sent" within 60 s;
     - R20: a web error banner clears on the next send.
2. **Core:** new `packages/client-core/src/store/send.ts` and `send-failure.ts` (moved from web `effects/sendFailure.ts`, which becomes a re-export), with tests, plus lines in a T10 section of `index.ts`. `ports.ts` gains `bytes` (classify, size, upload with progress, cancel) and `voice` (convert, upload), as plan section 4 sketches.
3. **Web:**
   - `effects/send.ts` becomes a binding;
   - `effects/ports.ts` gains the attachment and voice adapters from `lib/attachments.ts` and `lib/voice.ts`;
   - `realStore.ts` keeps its facade.
4. **Mobile:**
   - `effects/send.ts` keeps its inline validation (R19) and binds the pipeline;
   - `effects/ports.ts` maps the uploader, `statSize` and voice to `bytes` and `voice`;
   - `real-store.ts` moves `forwardOriginFor` and the upload-progress mutators into the core where they are shared.
5. **Behaviour:** R6, R18 and R20 only, each listed in the Report. No existing test is edited.
6. **Split rule:** if the diff passes about 900 lines, stop after core plus web, report, and the lead will chain mobile as its own task.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `@/test/wait` helpers, never a raw `setTimeout(resolve, 0)`), `docs/STORE_CORE_PLAN.md` sections 2.3, 4, 6 (T10), 7 and 8, the Reports of `work/T-0904-*.md`, `work/T-0906-*.md` and `work/T-0918-*.md`, `packages/client-core/src/store/*`, and both send effect files with their tests.

### Allowed files
`packages/client-core/src/store/send.ts`, `packages/client-core/src/store/send-failure.ts`, `packages/client-core/src/store/send.test.ts`, `packages/client-core/src/store/send-failure.test.ts`, `packages/client-core/src/store/ports.ts`, `packages/client-core/src/store/ctx.ts`, `packages/client-core/src/store/ledger.ts` (only what send needs), `packages/client-core/src/store/index.ts` (T10 section only), `apps/web/src/store/effects/send.ts`, `apps/web/src/store/effects/sendFailure.ts`, `apps/web/src/store/effects/ports.ts`, `apps/web/src/store/effects/ctx.ts`, `apps/web/src/store/realStore.ts`, `apps/web/src/store/realStore.send.test.tsx`, `apps/mobile/src/store/effects/send.ts`, `apps/mobile/src/store/effects/ports.ts`, `apps/mobile/src/store/effects/runtime.ts`, `apps/mobile/src/store/real-store.ts`, `apps/mobile/src/store/real-store.send.test.ts`, `work/T-0922-store-core-t10-send.md`.

No other task runs on these files.

### Checks (wave mode)
```bash
pnpm --filter @zilar/client-core exec vitest run --reporter=dot
pnpm --filter @zilar/web exec vitest run --reporter=dot src/store
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/store
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
- The Report gives the lines per side and lists R6, R18 and R20.
- Live check for Julio, on web and mobile:
  - send text, a sticker, a photo, voice and a forward;
  - turn the network off during an upload: "Not sent" appears within 60 s, then retry;
  - an error banner clears on the next send.

---

## Report (written by the worker when done)

## Review (written by Claude)

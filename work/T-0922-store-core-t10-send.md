---
id: T-0922
title: "Store core T10: the send pipeline (text, sticker, attachment, voice, forward; failure, deadline, retry) in packages/client-core, both stores on it, tests first (Q2, Q4)"
status: merged
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

**Decision: the split rule is triggered; this branch is the core + web half.**
`git diff --numstat main...HEAD -- packages/client-core apps/web` = added 1658, deleted 739 (net +919 lines), which passes the spec's ~900-line limit. Mobile is left untouched (still on its own `effects/send.ts`), so the lead can chain it as its own task; `apps/mobile` typechecks and its store suite still pass on this branch (see Checks).

**Commits, in order**
1. `1e3e93cf` — tests first, on the old code: new `apps/web/src/store/realStore.send.test.tsx`, 8 guard tests. Verified against the old code with the save-`git diff` → `git checkout --` → run → `git apply` method (no `git stash`): **8 passed**.
2. `c94e92a5` — the new expectation: R20 ("a stale web error banner clears on the next send"). On the old code: **8 passed, 1 failed** (the banner stayed set).
3. `9af6c2a2` — the move: core `send.ts` + `send-failure.ts`, the core ports, and the web binding.
4. `46890f41`, `9145597b`, `33578458` — fixes the full suites found after the move: prettier on the new test; keep web's empty-options (`{}`) text send in the core (an existing test pins it); keep web's size-0 facade return (R19).

**The move (what changed)**
- **Core:** new `packages/client-core/src/store/send.ts` (778), new `send-failure.ts` (70, moved verbatim from web), `ports.ts` (+55: `OutgoingBytes`, `VoiceOut`, `VoiceInput`, `SendPorts`), `ctx.ts` (+2: `actionError` on `CoreState`, read by R20's clear), `index.ts` (+2 T10 lines). New core tests `send.test.ts` (+384, 11 tests).
- **Web:** `effects/send.ts` (655 → 33 lines) is now a binding over the core; `effects/sendFailure.ts` (70 → 3) re-exports the core table; `effects/ports.ts` (+69/−14) builds the core `bytes`/`voice` ports from `AttachmentPort`/`VoicePort`; new `realStore.send.test.tsx` (+276, 10 tests).
- `realStore.ts` needed no edit: the facade already passes `ctx`, whose `StoreCtx` now satisfies the core `SendCtx`.

**Behaviour changes, each listed**
- **R6 (Q2 = yes):** voice/attachment/forward sends get the 60 s deadline in the core (`SEND_TIMEOUT_MS`, `armSendTimeout`/`settleSendTimeout`); a hung upload ends `failed` with `timed_out`. Web already had this and keeps it; the core carries it so the chained mobile half can adopt it. Core test "marks a hung upload timed_out after the deadline".
- **R18:** `retrySticker` does not re-enqueue the sticker signature, so a failed first send leaves one queue entry and a later identical sticker's echo links to the right bubble. Core test "does not re-enqueue the signature on a retry". (Web's behaviour; the mobile bug is fixed when mobile adopts core.)
- **R20 (Q4 = yes):** a stale `actionError` clears on the next validated send (sticker/attachment/voice) and on `retrySticker` — mobile's rule, now shared. Web test "clears a stale error banner on the next send".
- **D-1:** a failed text stays `sending` (core test).
- **R19:** each app's input validation stays in its facade — web's size-0 attachment return and empty-recording return live in `effects/send.ts` (web test "returns silently on a size-0 file"); mobile's inline banner is deferred with the mobile half.
- No other behaviour changed.

**Deviations from the spec (with reasons)**
- **`bytes`/`voice` are in a new `SendPorts`, not on `CorePorts`.** Adding required fields to `CorePorts` would force mobile's `corePorts` (in `real-store.ts`) to supply them, but the split rule leaves mobile untouched. The interfaces live in `ports.ts` as the spec asks; the core `SendCtx` requires `CorePorts & SendPorts`, and web's `PortsShape` supplies both. The chained mobile task moves them onto `CorePorts` when it wires the mobile adapters.
- **The core text send keeps `{}` for a plain text, not `undefined`.** Plan section 2.3 says the core uses `undefined` and that no web test pins `{}`; that is stale — `realStore.forward.test.tsx:318` pins `{}` for a forwarded comment, and no existing test may be edited. Recorded for the mobile half (its `real-store.mentions.test.ts` pins `undefined`; the chained task must reconcile).
- **`CoreState` read `actionError`.** R20 needs to read the current banner to clear only this chat's; it is an optional field added to `CoreState` (mobile's state already has it).
- The mobile half (tests first for R6/R18, mobile `send.ts` binding, `effects/ports.ts` uploader/`statSize`/voice mapping, `forwardOriginFor` and the upload-progress mutators moving into core, `cancelAttachment`/`cancelVoice`) is **not done** — it is the chained task.

**Checks (real results)**
- Core `send.test.ts`, 3 runs: 11 passed each.
- Web `realStore.send.test.tsx`, 3 runs: 10 passed each (9 before the R19 test was added).
- `@zilar/client-core` full: 19 files, 202 passed.
- `@zilar/web` `src/store` full: 26 files, 282 passed.
- `@zilar/mobile` `src/store` full (mobile untouched): 38 passed + 1 skipped files, 364 passed + 1 skipped tests.
- `pnpm --filter @zilar/mobile typecheck`: clean.
- `pnpm gate` (repo root, final, after the fixes): `gate: 11 changed file(s) against main`; `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS effect`, `PASS tests @zilar/client-core` (74.2s), `PASS tests @zilar/web` (92.5s); `scope: every changed file is inside the Allowed files`; `GATE PASS`. Gate ran once before the fixes too (same PASS/scope lines, without the two fix commits).

**Live check for Julio:** unchanged from the spec — text, sticker, photo, voice and forward on web; upload with the network off shows "Not sent" within 60 s, then retry; the error banner clears on the next send. Mobile is not part of this half.

## Review (written by Claude)

**Lead, 2026-10-10: approved for the core and web half. Mobile is chained to T-0929 under the split rule.**
- **The move:**
  - the send pipeline is in `packages/client-core/src/store/send.ts`, and `send-failure.ts` moved verbatim;
  - `bytes` and `voice` live in a separate `SendPorts`, so mobile's `CorePorts` is not forced;
  - web `effects/send.ts` went from 722 lines to a binding.
- **Tests first:** guards, then the failing R20 expectation (8 passed, 1 failed on the old code).
- **Behaviour on web:** R20 only: a stale banner clears on the next send. R6 and R18 were already web behaviour and are kept, and R19 stays in the facade. A plain text keeps `{}` options, which `realStore.forward.test.tsx:318` pins.
- **Nits for T-0929:**
  - `bytes.describe` runs twice per image send;
  - `retrySticker` clearing the banner has no test.
- **Check:** the combined check passes.
- **Live check for Julio on web:** send text, a sticker, a photo, voice and a forward; a failed upload shows "Not sent" and can be retried; an error banner clears on the next send.

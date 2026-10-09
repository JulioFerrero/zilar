---
id: T-0793
title: "WU21: VoiceMessage and AvatarUploader on Effect (playback interval and image loading as Effects)"
status: merged
milestone: M5
branch: task/T-0793-web-voice-avatar
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0793 (WU21): VoiceMessage and AvatarUploader on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU21), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **`apps/web/src/components/VoiceMessage.tsx`** (309, H1 H3 W4), tested in `VoiceMessage.test.tsx` and `VoiceMessage.player.test.tsx`. The first hit is `const timer = window.setInterval(...)` (the playback progress tick).
- **`apps/web/src/components/AvatarUploader.tsx`** (428, H1 W4), tested in `AvatarUploader.test.tsx`. The first hit is `async function loadImageSize(objectUrl)` (an image decode wrapped in a Promise).
- **The hooks** are in `apps/web/src/lib/effect/`. The finished models are `apps/web/src/routes/BlockedPage.tsx` and `apps/web/src/lib/useApprovalPolling.ts` (`Effect.repeat` with `Schedule`, T-0766).
- **The full web suite passes on main.** Run it once before you finish (`pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`).

### The conversion pattern (same for every web UI task)
- **The goal:** after this task each listed file imports Effect for its async work, and contains no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` of its own. That is the rule of `docs/audit/effect-100-plan.md` §1.3 and §3.6.
- **Use the hooks from T-0762** (`apps/web/src/lib/effect/use-action.ts`, `use-query.ts`; read their header comment):
  - `useAction(fn)` for user actions (submit, delete, toggle). It returns `[state, run, controls]`, and its `ignore` mode replaces the `busy` guards;
  - `useQuery(make, deps)` for loads, with `refresh` for reloads;
  - `failureOf(state)` and `isWaiting(state)` for the UI.
- **Calling existing API functions:** use `fromApi(() => apiFn(...))` (`apps/web/src/lib/effect/api-effect.ts`). It gives typed `ApiFailure` errors, which have `code`, `status` and `message`.
- **Timers and polling:** use `Effect.sleep`, `Effect.repeat` with `Schedule.spaced` or `Schedule.fixed`, inside `useQuery` or an atom, so unmount interrupts them. Debounce with `Effect.sleep` inside `useQuery` keyed on the input.
- **Keep the concurrency per item.** When a list has a button on each row, each row gets its own `useAction` (a small row component), so different rows can run at the same time while a double click on one row is still ignored. One `useAction` for the whole page would drop a second row's click (the lead's T-0767 review).
- **Keep the rendered structure.** Dialogs (`components/ui/dialog.tsx` is a non-portalled `fixed inset-0` overlay), lists and sections stay where they are in the tree. Moving a dialog into a row can clip it or stack it under other content (the lead's T-0783 review).
- **Non-API failures** may show the component's fixed fallback sentence instead of raw error text (`AGENTS.md`: fixed sentences). Mention it in the Report. **Exception:** a chat-store action that rejects with a plain `Error` carries a user-facing sentence the store wrote, so keep showing its `message`, as GroupPanel does since T-0781. Only non-`Error` causes get the fallback.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
Convert the two files with the pattern.
- **The playback tick** becomes an `Effect.repeat` on a `Schedule` with the same interval. It starts on play and is interrupted on pause, end or unmount.
- **`loadImageSize`** becomes an `Effect.callback` that clears the image handlers on interrupt.
- **Object URLs:** if they are revoked today, keep revoking them at the same moments.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/web/src/lib/effect/use-action.ts`, `apps/web/src/lib/useApprovalPolling.ts`, the two files and their tests.

### Allowed files
`apps/web/src/components/VoiceMessage.tsx`, `apps/web/src/components/AvatarUploader.tsx`, `work/T-0793-web-voice-avatar.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/components/VoiceMessage src/components/AvatarUploader
pnpm gate
```
Run `pnpm effect:map` and list each file's kind, then paste the whole web suite summary.

### Acceptance
- Both files import Effect, with no async, timers or try/catch of their own.
- The behaviour is the same, the tests pass unchanged, and the web suite is green.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**Files changed:** `apps/web/src/components/VoiceMessage.tsx`, `apps/web/src/components/AvatarUploader.tsx`, this task file. Test files unchanged.

**effect:map kind:** VoiceMessage.tsx = `effect`, no signals left. AvatarUploader.tsx = `effect`, no signals left. Map totals: 842 files, coverage 60.0% (effect 256, needs-effect 179, plain 304, exempt 103, legacy 0).

**Counts (the two target files):** before, 3 test files and 20 tests passed (VoiceMessage.test.tsx, VoiceMessage.player.test.tsx, AvatarUploader.test.tsx). After, the same 3 files and 20 tests pass, unchanged.

**Whole web suite (after):** `pnpm --filter @zilar/web test --maxWorkers=4 --reporter=dot`: Test Files 172 passed (172), Tests 1844 passed (1844). I did not measure the whole suite before the change.

**Gate (`pnpm gate`, run from the worktree root):**
- `gate: 2 changed file(s) against main`
- PASS install (frozen), PASS format, PASS lint, PASS typecheck, PASS effect, PASS tests @zilar/web
- `scope: every changed file is inside the Allowed files`
- `GATE PASS`

Other checks: `tsc --noEmit` for `apps/web/tsconfig.json` and `tsconfig.node.json` both exit 0. `oxlint` on the two files is clean. The first gate run listed a scratch file of mine; I deleted it and re-ran the gate.

**What changed**
- VoiceMessage: the progress interval is a `useQuery` tick, `Effect.repeat(Schedule.spaced(TICK_MS))` plus `Effect.delay(TICK_MS)`, rebuilt on each `playing` change (same pattern as ApprovalsPage). Transcript fetches use `useAction` with `fromApi(getVoiceTranscript)`. Play uses `useAction` (mode `replace`): `Effect.try` on `audio.play()`, then `tryPromise` on the returned Promise, and a refused play sets `failed`. The try/catch and the `.then`/`.catch` chains are gone.
- AvatarUploader: `loadImageSize` is an `Effect.callback` that clears `onload`/`onerror` on interrupt. `encodeExport` is an `Effect.callback` (`encodeAvatar`). Pick, save and remove are `useAction` effects. `busy` is `isWaiting` of the save and remove states. `createPreviewUrl`/`revokePreviewUrl` use `Effect.try` with `orElseSucceed`/`ignore`, with `Effect.runSync` in `closeCrop`. The save chain is `Effect.gen` with `matchEffect` for the error sentence.

**Deviations from the spec (and why)**
- Props are unchanged: `imageLoader` and `exporter` keep their Promise types, because the tests inject Promise fakes. The browser defaults are `Effect.runPromise(...)` wrappers around the Effect versions. The Effect callbacks therefore live behind a Promise seam.
- AvatarUploader does not use `fromApi`. `toApiFailure` would replace a plain `Error` carrying `code` (the test's rejection shape) with "Something went wrong", so the raw cause is kept and passed to the unchanged `friendlyUploadError`.
- `failureOf` is not used: every failure is handled inside its Effect with `matchEffect`, so the action states only need `isWaiting`.
- `encodeExport` was not in "What to build"; I converted it because it held the file's other `new Promise`.

**Behaviour differences**
1. VoiceMessage transcript errors: `fromApi` maps any non-`ApiError` to `unknown_error`, so the fixed fallback "Transcription failed. Try again." replaces the raw `Error.message` in that case. Every known code gives the same sentence. `getVoiceTranscript` throws `ApiError` on its failure paths, so no visible change is expected.
2. VoiceMessage: unmounting during a transcript fetch interrupts it. The answer is dropped and not cached. Before, the cache was filled and the state update was a no-op.
3. VoiceMessage: a second play request replaces a pending one (before, each click just called `play()`). The first `play()` call still happens synchronously inside the click, and the "Pause" label appears right after the click in the existing tests.
4. AvatarUploader: a newer pick replaces one still loading, and unmount also interrupts a load. The superseded or abandoned preview URL is revoked on interrupt (before, it leaked).
5. AvatarUploader: unmount during a save interrupts it. `onChanged` is not called afterwards (before, it ran on the unmounted parent).
6. AvatarUploader: a drawing or decode throw in the browser defaults rejects through `runPromise` and reaches `friendlyUploadError` as before. The text is the same, though it may be the raw Error message in that rare case.
7. The save failure path still does not revoke the crop URL (as before; I kept that).

**Open questions / unsure**
- The default seams go Effect, then Promise, then Effect again. Changing the props to Effect-typed would need the test fakes to change, which the task forbids. Please say if you want that follow-up.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the Report.
- **The components:** both are Effect files. `play()` still runs inside the click.
- **The injected `imageLoader` and `exporter` props stay Promise-typed** for the test fakes, which is accepted.
- **Fixed:** an abandoned preview URL is now revoked.
- **Behaviour changes accepted:** unmount interrupts the transcript fetch, the load and the save.
- **Results:** 20 tests and the whole web suite (1844) pass; the gate passed.
- **Follow-up:** the crop URL is not revoked after a failed save (a leak in the old code too).

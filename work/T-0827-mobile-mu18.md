---
id: T-0827
title: "MU18: mobile chat voice: voice-message, voice-player, voice-recorder on Effect"
status: merged
milestone: M5
branch: task/T-0827-mobile-mu18
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0827 (MU18): mobile chat voice: voice-message, voice-player, voice-recorder on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU18), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back. Julio checks voice messages on the phone before the next deploy.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/chat/voice-message.tsx` (602 lines; first hit at line 62: async/await/Promise @62; try/catch @171), tested in `voice-message.test.tsx`;
  - `apps/mobile/src/components/chat/voice-player.ts` (410 lines; first hit at line 48: try/catch @48; async/await/Promise @104), tested in `voice-player.test.ts`;
  - `apps/mobile/src/components/chat/voice-recorder.tsx` (426 lines; first hit at line 76: async/await/Promise @76; try/catch @99; timer @245), tested in `voice-recorder.test.tsx`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/components/chat/voice-message.tsx`, `apps/mobile/src/components/chat/voice-player.ts`, `apps/mobile/src/components/chat/voice-recorder.tsx`, `work/T-0827-mobile-mu18.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/voice-message src/components/chat/voice-player src/components/chat/voice-recorder
pnpm --filter @zilar/mobile typecheck
```
Run `pnpm exec prettier --write` on your changed files before committing. Do not start the emulator or Metro; the lead runs `pnpm phone:smoke` for the wave.

### Acceptance
- Each listed file is `effect` in `pnpm effect:map`, or `plain` when no async work of its own is left (no added Effect import just for the label).
- The texts and behaviour are the same, or each difference is listed in the Report.
- Existing tests pass unchanged, new tests pass both before and after the conversion, and the mobile typecheck is clean.
- Only Allowed files change.

---

## Report (written by the worker when done)

- **effect:map kinds:** `voice-message.tsx` effect, `voice-player.ts` effect, `voice-recorder.tsx` effect. The only remaining signal on each is W4, a false hit on `Effect.catch(` (not tier B). No `async`, `await`, `.then(`, `try`, `setTimeout` or `setInterval` is left in the three files.
- **Tests:** the three test files had 31 tests before and 31 after (all pass, unchanged; test files are not Allowed so no new tests). `pnpm --filter @zilar/mobile typecheck` is clean. `oxlint` on the three files is clean. I did not run `pnpm gate` or the whole suite (wave mode).
- **What changed:**
  - `voice-player.ts`: `releasePlayer` is an Effect run with `runSync`; native calls that may throw go through one `attempt` helper (`Effect.try` + `ignore`), the fire-and-forget `seekTo` calls through `attemptAsync`, the lazy `expo-audio` import through `Effect.tryPromise` + `runFork`, and `controls.seekTo` is `Effect.runPromise(...)` with the same `Promise<void>` type. The injected-factory path stays synchronous (`runSync`), which the existing tests need.
  - `voice-recorder.tsx`: `runRecorderBegin` / `runRecorderFinish` keep their Promise signatures and now wrap the new `runRecorderBeginEffect` / `runRecorderFinishEffect`. The two `setInterval`s are forked fibers (`startTicker`, sleep then tick, forever) interrupted by `stopTicker` on finish and on unmount; the 3 s error hint is an `Effect.sleep` fiber interrupted by the effect cleanup. `begin` and `finish` run their synchronous part first (refs, state, `stopTimer`) and the async part as a forked Effect. The mic permission prompt is still started from the press handler (`begin` -> `recorder.start()`), never from a later tick.
  - `voice-message.tsx`: `resolvePlaySource` keeps its Promise signature and wraps `resolvePlaySourceEffect`. The transcript read, the transcribe run and the model-status check are forked Effects; the transcript read fiber is interrupted on cleanup (replaces the `cancelled` flag).
- **Behaviour differences:**
  - Timers: a ticker's first tick comes one interval after the start, like `setInterval`, but the next tick is scheduled after the previous tick's work (a few ms drift instead of a fixed grid). Not visible at 100 ms / 250 ms for a timer label and a level sample.
  - A throw inside a ticker callback (`currentLevel`, `currentDurationMs`) is dropped by `Effect.catchDefect` inside the repeated effect (fix round 1), so the ticker keeps ticking like `setInterval`; the throw is not reported.
  - `finish` (recorder) and `resolvePlaySource` (bubble) used to be `void`-ed Promises, so a rejection was an unhandled rejection; they are now forked fibers and a failure is logged by Effect as an unhandled fiber error. Same non-handling, different log.
  - `controls.seekTo` and the two `seekTo` calls on resume: a synchronous throw from the native `seekTo` used to propagate; it is now dropped with the rejection (the rejection was already dropped).
  - The whistle `isAvailable()` probe in render and the other sync `try/catch` blocks give the same results (false / ignored on throw).
  - Everything else (texts, order of side effects, the `modelStatus` rejection falling back to `runTranscribe`) is the same. I kept the `onSaveTranscript?.(...) ?? saveTranscript(...)` expression as it was, so an injected `onSaveTranscript` that returns nothing still also calls `saveTranscript`.
- **Unsure / noticed, not changed:** in `toggle` the request guard is passed `{ current: playRequestRef.current }`, a snapshot, so the "last tap wins" check in `resolvePlaySource` can never fire from the bubble (only the extracted function's tests exercise it). I kept it as it is. The Effect paths in the components (tickers, transcribe run) have no test in the existing suites (they use `renderToStaticMarkup`), so they are covered by typecheck and by the phone smoke only.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Sonnet 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Fix round 1: the recording tickers survive a throwing tick (`catchDefect` inside the repeat).
- **Phone:** the wave branch is smoked on the emulator after the merge.

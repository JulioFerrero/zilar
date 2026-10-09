---
id: T-0814
title: "MU5: mobile whistle module: download, transcribe on Effect"
status: merged
milestone: M5
branch: task/T-0814-mobile-mu5
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0814 (MU5): mobile whistle module: download, transcribe on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU5), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/modules/zilar-whistle/src/download.ts` (150 lines; first hit at line 1: native module import @1; async/await/Promise @34; try/catch @42), **no test** (write `apps/mobile/modules/zilar-whistle/src/download.test.ts` first);
  - `apps/mobile/modules/zilar-whistle/src/transcribe.ts` (193 lines; first hit at line 13: try/catch @13; async/await/Promise @61), **no test** (write `apps/mobile/modules/zilar-whistle/src/transcribe.test.ts` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0814: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/modules/zilar-whistle/src/download.ts`, `apps/mobile/modules/zilar-whistle/src/download.test.ts`, `apps/mobile/modules/zilar-whistle/src/transcribe.ts`, `apps/mobile/modules/zilar-whistle/src/transcribe.test.ts`, `work/T-0814-mobile-mu5.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot modules/zilar-whistle/src/download modules/zilar-whistle/src/transcribe
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

- Commits: `0c793874` T-0814: tests before (new `download.test.ts` and `transcribe.test.ts`, written against the old code); the conversion commit follows.
- `effect:map` kinds: `apps/mobile/modules/zilar-whistle/src/download.ts` = `effect` (its H9 signal is the allowed expo-file-system import); `apps/mobile/modules/zilar-whistle/src/transcribe.ts` = `effect` (no signals left).
- Tests before: `download.test.ts` 22 passed, `transcribe.test.ts` 18 passed (40 in total, on the old code). Tests after: 40 passed, run 3 times in a row. Also run after the conversion: the 6 existing whistle test files in `apps/mobile/src/lib` (`whistle-checksum`, `whistle-model-status`, `whistle-native`, `whistle-port`, `voice-transcribe-flow`, `whistle-chunks`): 104 passed in total with the new tests. Existing tests unchanged.
- Typecheck: `pnpm --filter @zilar/mobile typecheck` exit 0 (the first run failed on typing in my new test files only; fixed).
- Exports unchanged: same names, parameters and Promise return types. Each export is `Effect.runPromise(...)` over a private Effect. `isAvailable()` stays synchronous via `Effect.runSync`.
- Behaviour differences: none observable. Internals: the `transcribe` queue is now `Semaphore.makeUnsafe(1)` with `withPermits(1)` instead of the hand-written Promise chain (same FIFO order, the permit releases on failure too). Rejections from the injected `sha256Of`, `tmp.move` and the native `sha256File`/`loadModel`/`amplitudeEnvelope` pass through as the same raw error values (`Effect.promise` or a caught `Effect.try`), as before.
- Native imports (`expo-file-system`, `ZilarWhistleModule`) stay. No `process.env` read in either file.
- After the tests-before commit, the conversion commit changes only the types and access style of the two new test files (mock typings, `mock.calls[0]?.[n]` instead of tuple destructuring), so the typecheck passes. No assertion changed.
- Unsure: nothing. The `dist/effect-map/` output of `pnpm effect:map` is git-ignored and was left in the worktree.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Whistle download and transcribe converted; no behaviour change reported.
- **Phone:** the wave branch is smoked on the emulator after the merge.

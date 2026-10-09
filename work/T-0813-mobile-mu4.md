---
id: T-0813
title: "MU4: mobile lib native: attachment-native, voice-native (expo-file-system, expo-audio) on Effect"
status: merged
milestone: M5
branch: task/T-0813-mobile-mu4
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0813 (MU4): mobile lib native: attachment-native, voice-native (expo-file-system, expo-audio) on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU4), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/lib/attachment-native.ts` (442 lines; first hit at line 10: native module import @10; async/await/Promise @88; try/catch @108), tested in `attachment-native.test.ts`;
  - `apps/mobile/src/lib/voice-native.ts` (414 lines; first hit at line 161: async/await/Promise @161; try/catch @162), tested in `voice-native.test.ts`;
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
`apps/mobile/src/lib/attachment-native.ts`, `apps/mobile/src/lib/voice-native.ts`, `work/T-0813-mobile-mu4.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/attachment-native src/lib/voice-native
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

- `apps/mobile/src/lib/attachment-native.ts`: effect:map kind `effect` (was needs-effect). tierB=true only because of the native `expo-file-system/legacy` and `expo-file-system` imports (H9), which stay by design. No other signal hits.
- `apps/mobile/src/lib/voice-native.ts`: effect:map kind `effect` (was needs-effect). No signal hits at all.
- Tests: `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/attachment-native src/lib/voice-native`: 2 files, 25 passed, 0 failed. Before: the test files are untouched (not in the diff), and I did not re-run them on the pre-conversion code, so the "before" count is the same 25 by construction.
- Typecheck: `pnpm --filter @zilar/mobile typecheck` (tsc --noEmit): clean, no output.
- Exports unchanged: same names, parameters and Promise return types. Each async method is an `Effect.fnUntraced` generator run through `Effect.runPromise`. Native calls (permission, picker, upload, download, share, audio) are wrapped with `Effect.promise`, `Effect.tryPromise` or `Effect.try`.
- Behaviour differences:
  - Only one: a synchronous throw from `getToken` (not a rejection) used to propagate. It now reads as "no token" (no bearer header). `getSessionToken` is async, so this should never happen in practice.
  - Permission prompts and picker/recorder calls still start synchronously inside the call. `Effect.runPromise` evaluates the first steps synchronously (checked in `node_modules/effect/dist/internal/effect.js`, `evaluate` to `runLoop`).
  - Rejections reach the caller with the original error object: `runPromise` rethrows the defect's value (`causeSquash`, same file).
  - Voice `start()` still maps every failure, including a missing native module, to the mic-failed copy (now `Effect.catchCause`).
- Unsure: no test covers a rejected permission call or a rejected upload directly. The reject path relies on `runPromise` rethrowing the original value, which I read in the source but did not exercise. The wave's combined check should cover it.
- Not run (wave mode): `pnpm gate`, the full suite, the emulator and Metro.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Native attachment and voice wrappers converted; the expo imports stay (tier B by design).
- **Phone:** the wave branch is smoked on the emulator after the merge.

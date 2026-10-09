---
id: T-0817
title: "MU8: mobile chat screen app/chat/[id].tsx on Effect"
status: merged
milestone: M5
branch: task/T-0817-mobile-mu8
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0817 (MU8): mobile chat screen app/chat/[id].tsx on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU8), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/chat/[id].tsx` (1095 lines; first hit at line 188: env read @188; async/await/Promise @243; try/catch @248), **no test** (write `apps/mobile/src/components/screens/chat-id-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0817: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/components/screens/chat-id-screen.test.tsx`, `work/T-0817-mobile-mu8.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/chat-id-screen.test.tsx
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

- **effect:map:** `apps/mobile/src/app/chat/[id].tsx` is `effect` (not tier B). Remaining soft signals: W4 (false positive from `Effect.catch(` and the `catch:` key of `Effect.tryPromise`) and W7 (three `process.env.NODE_ENV` / `EXPO_PUBLIC_ZILAR_MOCK` demo-data reads; `mock/gate.ts` has no constant for them, so the reads stay, as the spec allows).
- **Tests:** before: no test for the screen. New `apps/mobile/src/components/screens/chat-id-screen.test.tsx`, 32 tests (jsdom, the real screen mounted, child components stubbed), committed first as "T-0817: tests before" and green on the old code. After the conversion: 32 passed, unchanged, 3 runs in a row; `src/lib/hooks-guard.test.ts` (reads this file) also passes (6). Mobile `typecheck`: clean.
- **How:** every `void x().then().catch().finally()` chain and the `async`/`try`/`catch` in `patch` is now one module-level helper `runInBackground(call, { onSuccess, onFailure, onSettled })` built on `Effect.tryPromise` + `Effect.tap` + `Effect.catch` + `Effect.ensuring`, started with `Effect.runFork`. Used for: opening an attachment, pin, unpin (message menu and pins sheet), `patch` (status, owner, link), topic info loads (members, AIs, roles), saving topic roles, leave, archive and both role retries. `patch` now returns `void` (nobody awaited it); the `void patch(...)` call sites lost the `void`.
- **Behaviour differences:** none intended. I did not use `useAction` on purpose: its default mode drops a second tap while one runs, and `replace` cancels the first, but the old chains let concurrent taps (two pins, two patches) run side by side, so `runFork` keeps that exactly. No new hooks, so the hooks-above-`if (!chat)` rule holds. Two edge notes: a synchronous throw from `opener.open` now lands in the "Could not open that file" message instead of escaping the tap handler; nothing is interrupted on unmount (same as before: late state updates after unmount are no-ops).
- **Unsure:** whether the lead prefers `useAction` per action despite the single-flight change above. Not run: `pnpm gate`, the whole suite, the emulator (wave mode).

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Sonnet 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Chat screen converted; no behaviour change reported.
- **Phone:** the wave branch is smoked on the emulator after the merge.

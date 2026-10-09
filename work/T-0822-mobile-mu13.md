---
id: T-0822
title: "MU13: mobile settings D: stickers, sticker-pack on Effect"
status: merged
milestone: M5
branch: task/T-0822-mobile-mu13
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0822 (MU13): mobile settings D: stickers, sticker-pack on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU13), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/settings/sticker-pack.tsx` (819 lines; first hit at line 121: async/await/Promise @121; try/catch @157), **no test** (write `apps/mobile/src/components/screens/settings-sticker-pack-screen.test.tsx` first);
  - `apps/mobile/src/app/settings/stickers.tsx` (639 lines; first hit at line 106: async/await/Promise @106; try/catch @125), **no test** (write `apps/mobile/src/components/screens/settings-stickers-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0822: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/settings/sticker-pack.tsx`, `apps/mobile/src/components/screens/settings-sticker-pack-screen.test.tsx`, `apps/mobile/src/app/settings/stickers.tsx`, `apps/mobile/src/components/screens/settings-stickers-screen.test.tsx`, `work/T-0822-mobile-mu13.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/settings-sticker-pack-screen.test.tsx src/components/screens/settings-stickers-screen.test.tsx
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

- **effect:map:** `apps/mobile/src/app/settings/sticker-pack.tsx` = `effect`; `apps/mobile/src/app/settings/stickers.tsx` = `effect`. Both keep a weak W4 hit, which is only the `Effect.catch` name (the signal regex matches `catch(`), not a try/catch.
- **Tests before:** new `apps/mobile/src/components/screens/settings-sticker-pack-screen.test.tsx` (13) and `settings-stickers-screen.test.tsx` (14), written on the old code: 27 pass (commit "T-0822: tests before").
- **Tests after:** the same 27 pass on the converted code. Existing `components/stickers/stickers-screen.test.tsx` and `sticker-pack-screen.test.tsx` (27 together) pass unchanged after conversion. I did not run those two before the conversion; they are not edited.
- **Repeat runs:** the 54 screen tests passed on three runs.
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` clean. Prettier check clean on the four files.
- **Spec note:** the spec says both screens have no test. They do: the two `components/stickers/*` test files above render both screens, forcing `useState` by call order. So the conversion keeps every `useState` call in its original order, with the same initial values.
- **Behaviour differences:**
  - Async work runs through `Effect.runFork` (promise calls wrapped with `fromApi`, `Effect.tryPromise` or `Effect.promise`), not `useAction`/`useQuery`. `useAction` per row would have changed the `useState` order the existing tests depend on. Texts and branches are the same.
  - `sticker-pack.tsx` load keeps the raw error, not `ApiFailure`, because `lookupFailureKind` checks `StickersApiError` with `instanceof`.
  - The picker and the image preparer were not caught before. A rejection there is now an Effect defect (logged by the runtime) instead of an unhandled promise rejection. No text changes.
  - The session-token read is interrupted on unmount (the old `cancelled` flag); the other requests keep running after unmount, as before.
  - Each request's first step now runs in an Effect fiber. I did not measure any timing change.
  - Permission prompts: none in these two files.
- **Unsure:** whether `Effect.runFork` per action is acceptable where the brief says `useAction`. I chose it to keep the state order. The `pnpm phone:smoke` check for the wave is still for the lead.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 27 new tests for the sticker settings screens.
- **Phone:** the wave branch is smoked on the emulator after the merge.

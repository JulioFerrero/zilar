---
id: T-0815
title: "MU6: mobile tabs: index, ais, profile, settings, _layout + app/_layout on Effect"
status: todo
milestone: M5
branch: task/T-0815-mobile-mu6
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0815 (MU6): mobile tabs: index, ais, profile, settings, _layout + app/_layout on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU6), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/_layout.tsx` (74 lines; first hit at line 24: try/catch @24 (weak)), **no test** (write `apps/mobile/src/components/screens/_layout-screen.test.tsx` first);
  - `apps/mobile/src/app/(tabs)/_layout.tsx` (76 lines; first hit at line 28: async/await/Promise @28; try/catch @38), **no test** (write `apps/mobile/src/components/screens/tabs-_layout-screen.test.tsx` first);
  - `apps/mobile/src/app/(tabs)/ais.tsx` (249 lines; first hit at line 67: async/await/Promise @67; try/catch @71), **no test** (write `apps/mobile/src/components/screens/tabs-ais-screen.test.tsx` first);
  - `apps/mobile/src/app/(tabs)/index.tsx` (499 lines; first hit at line 84: env read @84; async/await/Promise @174; try/catch @178), **no test** (write `apps/mobile/src/components/screens/tabs-index-screen.test.tsx` first);
  - `apps/mobile/src/app/(tabs)/profile.tsx` (219 lines; first hit at line 52: async/await/Promise @52; try/catch @58), **no test** (write `apps/mobile/src/components/screens/tabs-profile-screen.test.tsx` first);
  - `apps/mobile/src/app/(tabs)/settings.tsx` (207 lines; first hit at line 144: async/await/Promise @144; try/catch @150), **no test** (write `apps/mobile/src/components/screens/tabs-settings-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0815: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/components/screens/_layout-screen.test.tsx`, `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/components/screens/tabs-_layout-screen.test.tsx`, `apps/mobile/src/app/(tabs)/ais.tsx`, `apps/mobile/src/components/screens/tabs-ais-screen.test.tsx`, `apps/mobile/src/app/(tabs)/index.tsx`, `apps/mobile/src/components/screens/tabs-index-screen.test.tsx`, `apps/mobile/src/app/(tabs)/profile.tsx`, `apps/mobile/src/components/screens/tabs-profile-screen.test.tsx`, `apps/mobile/src/app/(tabs)/settings.tsx`, `apps/mobile/src/components/screens/tabs-settings-screen.test.tsx`, `work/T-0815-mobile-mu6.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/_layout-screen.test.tsx src/components/screens/tabs-_layout-screen.test.tsx src/components/screens/tabs-ais-screen.test.tsx src/components/screens/tabs-index-screen.test.tsx src/components/screens/tabs-profile-screen.test.tsx src/components/screens/tabs-settings-screen.test.tsx
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

## Review (written by Claude)

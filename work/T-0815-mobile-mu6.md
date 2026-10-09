---
id: T-0815
title: "MU6: mobile tabs: index, ais, profile, settings, _layout + app/_layout on Effect"
status: merged
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

**effect:map kinds (after the conversion, from `pnpm effect:map`):**
- `apps/mobile/src/app/_layout.tsx`: effect (signals: none)
- `apps/mobile/src/app/(tabs)/_layout.tsx`: effect
- `apps/mobile/src/app/(tabs)/ais.tsx`: effect
- `apps/mobile/src/app/(tabs)/index.tsx`: effect (keeps one `process.env` read, W7, see below)
- `apps/mobile/src/app/(tabs)/profile.tsx`: effect
- `apps/mobile/src/app/(tabs)/settings.tsx`: effect

**Tests:** before: 0 tests for these six screens. Commit "T-0815: tests before" adds 6 files in `apps/mobile/src/components/screens/` with 55 tests (layout 6, tabs-layout 4, ais 13, index 10, profile 15, settings 7). They pass on the old code and on the converted code (run 3 times, 55/55 each time). No existing test changed.

**Commits:** "T-0815: tests before" (first commit, tests only) and the conversion commit.

**Typecheck:** `apps/mobile`: `tsc --noEmit` exit 0.

**Behaviour differences:**
- index: a second mute/pin/archive tap on the same chat while its save is waiting is dropped. Each chat has its own guard (one action per row), so a change on another chat is sent at once. Before, each tap sent its own request.
- ais: stop/resume and delete have a guard per AI id and action: a second tap on the same AI's action is dropped, another AI's action is sent. The AI calls are not mapped to `ApiFailure`, because `describeAisError` and the 409 check read `AisApiError` (raw errors pass through).
- Fix round 1 (lead review): the guards were screen-wide `useAction`; now keyed (see above). Closing the Chats sheet is still blocked while its change saves (as before), so a second chat is reached in the app only after that save ends; the test opens the second chat's row directly. The success handlers close a sheet only if it still shows that chat or AI. Known edge: a failure message of a save shows in whichever sheet is open at that moment.
- profile: the photo picker, save and remove share one run at a time, as the old `photoRef` did. A synchronous throw from `createPicturePicker()` now shows the fixed pick message instead of throwing out of the tap.
- root layout: `bootstrap()` used to be a bare `void` (an unhandled rejection if it failed). Now it runs as `Effect.promise` under `runFork`, so a failure is a defect in an unobserved fiber. The splash calls keep their silent `.catch`.
- profile: copying the username used to leave a rejected Promise unhandled. Now it runs under `runFork`; a failure is silent. Same text copied.
- focus loads (tabs layout, settings) are interrupted when the screen loses focus, as the old `active` flag did. The AIs and profile reloads are not interrupted, as before.
- none else.

**Not converted:**
- `index.tsx` line 86 still reads `process.env.NODE_ENV` and `EXPO_PUBLIC_ZILAR_MOCK` (W7). `apps/mobile/src/mock/gate.ts` has no helper for "use the mock search API", so I left the read.

**Unsure:**
- `Effect.runPromise` in the avatar uploader: I checked in `effect/dist/internal/effect.js` that a typed failure rejects with the raw error, and the test "rejects an upload that has no session" confirms `ProfileApiError`.
- Focus-driven loads use `Effect.runFork` with a `useState` setter, not `useQuery`: a `useQuery` would fetch twice on mount with `useFocusEffect` and would show stale rows during a reload.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 55 tests written first, 59 after fix round 1: the mute/pin/archive and AI stop/delete guards are per row, so a second chat is not dropped while the first saves.
- **Phone:** the wave branch is smoked on the emulator after the merge.

---
id: T-0820
title: "MU11: mobile settings B: connections, integrations on Effect"
status: merged
milestone: M5
branch: task/T-0820-mobile-mu11
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0820 (MU11): mobile settings B: connections, integrations on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU11), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/settings/connections.tsx` (492 lines; first hit at line 77: async/await/Promise @77; try/catch @81), **no test** (write `apps/mobile/src/components/screens/settings-connections-screen.test.tsx` first);
  - `apps/mobile/src/app/settings/integrations.tsx` (720 lines; first hit at line 68: async/await/Promise @68; try/catch @72), **no test** (write `apps/mobile/src/components/screens/settings-integrations-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0820: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/settings/connections.tsx`, `apps/mobile/src/components/screens/settings-connections-screen.test.tsx`, `apps/mobile/src/app/settings/integrations.tsx`, `apps/mobile/src/components/screens/settings-integrations-screen.test.tsx`, `work/T-0820-mobile-mu11.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/settings-connections-screen.test.tsx src/components/screens/settings-integrations-screen.test.tsx
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

- Commits: `15251dbd` "T-0820: tests before conversion" (both new test files, on the old code), `d417f3c5` (first conversion), then `T-0820: fix round 1` (restores the state shape the existing tests need; see below).
- Fix round 1 (lead wave check): the four existing `connections-screen.test.tsx` and nine `integrations-screen.test.tsx` cases failed because the first conversion moved the screen state into `useAction`. Both screens now keep their original `useState` shape and hook order (the existing tests force state through it). Each network call is an Effect run by `useAction`, which writes its result into that state. `useAction` also ignores a second press while a call runs, and interrupts a running call on unmount. The existing tests are unchanged.
- `effect:map` kinds: `apps/mobile/src/app/settings/connections.tsx` was `needs-effect`, now `effect`; `apps/mobile/src/app/settings/integrations.tsx` was `needs-effect`, now `effect`.
- Tests: before the conversion the two files had none. New tests: `settings-connections-screen.test.tsx` 9, `settings-integrations-screen.test.tsx` 10 (19 total). All 19 pass on the old code and on the converted code, and three repeat runs were green. Rendering uses jsdom with `react-dom/client` (the media-sheet and use-action pattern), with DOM stand-ins for the native primitives.
- Typecheck: `pnpm --filter @zilar/mobile typecheck` exit 0. Prettier check clean on the four files.
- Shape: the Test lock is one list-level action, so it is global again, as before. Card helpers stay Promise-based (they never reject) and are wrapped with `Effect.promise`. API calls use `Effect.tryPromise` with the fixed sentence as the typed error, not `fromApi`, because the sentence depends on the `ConnectionsApiError` / `IntegrationsApiError` class, which `ApiFailure` does not keep. `useAction` does not call `useState`, so the test mocks see the same hook order as before.
- Behaviour differences:
  - A focus reload while another load is in flight now replaces it (`mode: 'replace'`): the last load to start wins. Before, both ran and the last to finish won.
  - Leaving the screen or closing the add form during a save, test, remove or load interrupts that call. The server still applies it, but the screen does not update afterwards (the setState calls ran on an unmounted component before, with no visible effect).
  - Otherwise none: texts, error sentences, the 404 owner check, the write-only key clearing, the reload-after-save, the single-flight guards, and the order of the state updates are the same.
- Verification (fix round 1): `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/connections src/components/integrations src/components/screens/settings-connections src/components/screens/settings-integrations`: 10 files, 84 tests, green in 3 runs. `oxlint` on the four files: clean. `pnpm --filter @zilar/mobile typecheck`: exit 0. `effect:map`: both screens `effect`.
- Unsure: nothing open.


## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 19 new tests. Wave check fix: both screens keep their original `useState` shape so the existing screen tests pass; the Test lock is global again, as before.
- **Phone:** the wave branch is smoked on the emulator after the merge.

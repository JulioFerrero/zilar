---
id: T-0824
title: "MU15: mobile components/ais B: tool-detail-sheet, tools-section on Effect"
status: merged
milestone: M5
branch: task/T-0824-mobile-mu15
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0824 (MU15): mobile components/ais B: tool-detail-sheet, tools-section on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU15), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/ais/tool-detail-sheet.tsx` (778 lines; first hit at line 558: async/await/Promise @558; try/catch @559), tested in `tool-detail-sheet.test.tsx`;
  - `apps/mobile/src/components/ais/tools-section.tsx` (178 lines; first hit at line 28: async/await/Promise @28; try/catch @29), tested in `tools-section.test.tsx`;
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
`apps/mobile/src/components/ais/tool-detail-sheet.tsx`, `apps/mobile/src/components/ais/tools-section.tsx`, `apps/mobile/src/components/ais/tools-section.test.tsx` (fix round 1), `work/T-0824-mobile-mu15.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/ais/tool-detail-sheet src/components/ais/tools-section
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

- **effect:map kinds (after):** `apps/mobile/src/components/ais/tool-detail-sheet.tsx` = effect (no signals left); `apps/mobile/src/components/ais/tools-section.tsx` = effect (no signals left). Before: both needs-effect (async at 558 and 28).
- **Tests:** before 38 passed (2 files); after 38 passed (2 files). Both checks run: vitest on the two test files (dot reporter) and `pnpm --filter @zilar/mobile typecheck` (exit 0). Did not run pnpm gate, the emulator or Metro, per wave mode. No new tests: the test files are not in Allowed files.
- **Exports:** `loadAiTools(api, aiId)` is now `export const` returning `runMobile(loadAiToolsEffect(...))`; same name, args and Promise return, and the rejection is still the original error (checked by the existing `rejects.toMatchObject` test). `loadAiToolsEffect` is new. Only `ToolsSection` and its tests import it.
- **Behaviour differences:**
  - tools-section (fix round 1): a reload (Retry, or closing the tool sheet) calls the query's refresh, so the rows stay on screen until the reload answers, and "Loading…" shows only before the first list. The close callback now calls `reloadTools()`; the test that pinned `setReloadTick` was updated to match. A new test drives the real loader atom: rows, reload in flight (rows still shown), new rows.
  - tools-section: after a delete the removed tool is kept out by an id list (`deletedIds`) applied to the loaded list; the list is the same as before.
  - tool-detail-sheet: revert and run now run through `useAction`. Closing the sheet mid-revert or mid-run stops the client from waiting for it; the server call still completes (the call does not take an abort signal). Nothing visible changes, since the sheet is gone.
  - tool-detail-sheet: the delete is `Effect.uninterruptible`, so closing the sheet mid-delete still calls `onDeleted` and the list drops the tool, as before.
  - tool-detail-sheet: a tap on another version while one version load is running is ignored (`useAction` ignore mode). The version rows are disabled while busy, so this should not be reachable.
  - Texts are unchanged: `changeErrorMessage` and `runErrorMessage` get the original error through `ToolCallFailed.source`. Error lines are cleared when a call starts, as before.
  - Everything else: same texts, same order of requests (load: the three reads run together, as `Promise.all` did), same one-action-at-a-time guard (`actionRef`, released by `Effect.ensuring`).
- **Unsure:** (1) none on the reload flash any more (fixed in round 1). (2) I checked the `Effect.uninterruptible` delete and the runtime rejection shape by reading effect 4.0.2 (`internal/effect.js` `causeSquash`), not by a test of closing the sheet mid-delete. (3) `useQuery` with the sheet is tested only through SSR render and the existing tests; no mount-and-run test exists for the new effects.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Fix round 1: Retry and closing the tool sheet keep the rows on screen until the reload answers (new test).
- **Phone:** the wave branch is smoked on the emulator after the merge.

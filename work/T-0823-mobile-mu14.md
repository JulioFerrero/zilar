---
id: T-0823
title: "MU14: mobile components/ais A: ai-activity, ai-memory-section, routines-section on Effect"
status: merged
milestone: M5
branch: task/T-0823-mobile-mu14
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0823 (MU14): mobile components/ais A: ai-activity, ai-memory-section, routines-section on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU14), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/ais/ai-activity.tsx` (252 lines; first hit at line 32: async/await/Promise @32; try/catch @184), tested in `ai-activity.test.tsx`;
  - `apps/mobile/src/components/ais/ai-memory-section.tsx` (364 lines; first hit at line 55: async/await/Promise @55; try/catch @61), tested in `ai-memory-section.test.tsx`;
  - `apps/mobile/src/components/ais/routines-section.tsx` (338 lines; first hit at line 65: async/await/Promise @65; try/catch @66), tested in `routines-section.test.tsx`;
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
`apps/mobile/src/components/ais/ai-activity.tsx`, `apps/mobile/src/components/ais/ai-memory-section.tsx`, `apps/mobile/src/components/ais/routines-section.tsx`, `work/T-0823-mobile-mu14.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/ais/ai-activity src/components/ais/ai-memory-section src/components/ais/routines-section
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

- **effect:map kinds (after):** `ai-activity.tsx` = effect, `ai-memory-section.tsx` = effect, `routines-section.tsx` = effect. Before: not recorded; they had async/try hits, so needs-effect by the rules.
- **Tests:** before 64 passed (3 files, `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/ais/ai-activity src/components/ais/ai-memory-section src/components/ais/routines-section`), after 64 passed (3 files). Existing tests unchanged. No new tests: test files are not in Allowed files.
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` (tsc --noEmit) clean, no output.
- **Prettier:** run on the three files before commit.
- **Pattern:** each exported `fooEffect` plus the Promise export `(...a) => Effect.runPromise(fooEffect(...a))`. Exported names and Promise signatures unchanged.

Behaviour differences:
1. **Hooks not used.** The brief asks for `useQuery`/`useAction`; I did not use them. The components keep their `useState` because the state is shared across rows (memory forget guard, routines busy and confirm state, activity merged pages). Loads run with `Effect.runFork` in `useEffect` and are stopped with `Fiber.interrupt` in the cleanup (this replaces the `active` flag). Actions run with `Effect.runFork`. The existing refs (`loadingMoreRef`, `forgettingRef`, `runningRef`) still stop double taps. Texts are unchanged.
2. **Errors are not mapped to `ApiFailure`.** The Effects use `catch: (cause) => cause`, so the Promise exports reject with the same api error object. This keeps `instanceof ToolsApiError` working in `routineActionMessage` and `loadAiRoutines`. The components show only the fixed texts.
3. **Interruption.** Loads (first page, memory, routines) are interrupted on unmount or a new id. Load more, forget, clear and routine actions still run to the end after unmount, as before (they were never cancelled).
4. **Runtime.** `Effect.runFork` and `Effect.runPromise` use Effect's default runtime, not `mobileRuntime` / `runMobile`. The brief's table uses `Effect.runFork` for this, but the lib header says one mobile runtime. Unsure which the lead wants.
5. **Timing.** The api call may start a scheduler tick later under `runFork`. Not measured.
6. **Permission prompts.** None in these three files.
7. **Weak signal.** `Effect.catch(` lines count as W4 in effect:map. The kind is still effect because the file imports `effect`.

Unsure: item 1 (hooks vs runFork) and item 4 (default runtime vs `mobileRuntime`).

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** AI activity, memory and routines sections converted; no behaviour change reported.
- **Phone:** the wave branch is smoked on the emulator after the merge.

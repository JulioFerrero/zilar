---
id: T-0834
title: "MU25: mobile small components: avatar-native, card-save, save-connection, machine-change, approvals/rows on Effect"
status: merged
milestone: M5
branch: task/T-0834-mobile-mu25
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0834 (MU25): mobile small components: avatar-native, card-save, save-connection, machine-change, approvals/rows on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU25), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/approvals/rows.ts` (178 lines; first hit at line 132: async/await/Promise @132), tested in `rows.test.tsx`;
  - `apps/mobile/src/components/connections/save-connection.ts` (46 lines; first hit at line 19: async/await/Promise @19; try/catch @23), tested in `save-connection.test.ts`;
  - `apps/mobile/src/components/integrations/card-save.ts` (144 lines; first hit at line 23: async/await/Promise @23; try/catch @29), tested in `card-save.test.ts`;
  - `apps/mobile/src/components/machines/machine-change.ts` (34 lines; first hit at line 18: async/await/Promise @18; try/catch @24), tested in `machine-change.test.ts`;
  - `apps/mobile/src/components/settings/avatar-native.ts` (284 lines; first hit at line 1: native module import @1; async/await/Promise @98; try/catch @119; JSON.parse @200), tested in `avatar-native.test.ts`;
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
`apps/mobile/src/components/approvals/rows.ts`, `apps/mobile/src/components/connections/save-connection.ts`, `apps/mobile/src/components/integrations/card-save.ts`, `apps/mobile/src/components/machines/machine-change.ts`, `apps/mobile/src/components/settings/avatar-native.ts`, `work/T-0834-mobile-mu25.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/approvals/rows src/components/connections/save-connection src/components/integrations/card-save src/components/machines/machine-change src/components/settings/avatar-native
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

- **effect:map kinds (after):** `approvals/rows.ts` effect; `connections/save-connection.ts` effect; `integrations/card-save.ts` effect; `machines/machine-change.ts` effect; `settings/avatar-native.ts` effect (its only signal left is H9, the `expo-file-system` native import, which stays).
- **Tests:** the five test files, 42 passed before and 42 passed after (no test edited, none added). Nearest test of `rows.ts` is `components/approvals/approvals.test.ts` (`decideScreenRow`), not `rows.test.tsx`: 25 passed after.
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` clean (`tsc --noEmit`, no output). `pnpm exec oxlint` on the five files: exit 0, no findings (lead's note).
- **Approach:** each exported function keeps its Promise signature and runs its Effect through `runMobile` (`apps/mobile/src/lib/effect/runtime.ts`). Native and API calls use `Effect.tryPromise` with the rejection kept as the error, so the same error object reaches the caller. `pickPicture` and the avatar upload are `Effect.fnUntraced` generators with the early returns kept.
- **Behaviour differences:**
  - `avatar-native.ts`: `JSON.parse` (in `parseAvatarUploadBody` and `toAvatarUploadError`) is now `Schema.fromJsonString` decoded with `Schema.decodeUnknownOption`, then `Option.getOrNull`. Same result for valid JSON, invalid JSON gives null as before. The two sync exports stay sync.
  - `card-save.ts` `saveEmailCard` and `saveVoiceCard`: the `trim()` calls stay in the sync function body, outside the Effect, as before the change only inside the async body. A non-string input (a type error) now throws synchronously instead of rejecting. Nothing else changes.
  - `approvals/rows.ts` `decideScreenRow`: `applyDecision` folds all its failures into its outcome, so it wraps with `Effect.promise` (a rejection would surface unchanged).
  - none otherwise: same texts, same order of calls, same fallbacks.
- **Unsure:** the `trim()` placement above is the only edge I did not make identical; I judged it a type-level case. I did not run the whole suite or `pnpm gate`, as the wave rules say.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Small components converted; sync exports stay sync.
- **Phone:** the wave branch is smoked on the emulator after the merge.

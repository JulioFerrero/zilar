---
id: T-0832
title: "MU23: mobile stickers: pack-editor, sticker-native, telegram-import-sheet on Effect"
status: merged
milestone: M5
branch: task/T-0832-mobile-mu23
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0832 (MU23): mobile stickers: pack-editor, sticker-native, telegram-import-sheet on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU23), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/stickers/pack-editor.ts` (293 lines; first hit at line 200: async/await/Promise @200; try/catch @201), tested in `pack-editor.test.ts`;
  - `apps/mobile/src/components/stickers/sticker-native.ts` (213 lines; first hit at line 1: native module import @1; async/await/Promise @78; try/catch @79), tested in `sticker-native.test.ts`;
  - `apps/mobile/src/components/stickers/telegram-import-sheet.tsx` (333 lines; first hit at line 75: async/await/Promise @75; try/catch @78), tested in `telegram-import-sheet.test.tsx`;
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
`apps/mobile/src/components/stickers/pack-editor.ts`, `apps/mobile/src/components/stickers/sticker-native.ts`, `apps/mobile/src/components/stickers/telegram-import-sheet.tsx`, `work/T-0832-mobile-mu23.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/stickers/pack-editor src/components/stickers/sticker-native src/components/stickers/telegram-import-sheet
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

- `effect:map` kind after the task (from `dist/effect-map/data.json`, the generator's own output): `pack-editor.ts` effect, `sticker-native.ts` effect, `telegram-import-sheet.tsx` effect. Before: no Effect import and async/try signals, so needs-effect (not re-measured on HEAD).
- Tests: `pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/stickers/pack-editor src/components/stickers/sticker-native src/components/stickers/telegram-import-sheet`: 3 files, 36 passed, 0 failed. No test file changed, so the before count is the same 36 (not re-run on HEAD). No new tests: the test files are not in Allowed files.
- Typecheck: `pnpm --filter @zilar/mobile typecheck` exit 0. Also `oxlint` on the three files exit 0, and `prettier --check` clean.
- Exports: all names, signatures and Promise return types are unchanged (`runSavePack`, `runDeletePack`, `createStickerSizeReader`, `createStickerPreparer`, `createStickerImagePicker`, `TelegramImportSheet`, and the `StickerSizeReader`, `StickerImagePreparer`, `StickerImagePicker` interfaces). Each is a thin `Effect.runPromise` over an Effect body.
- `telegram-import-sheet.tsx`: the `useState` shape is kept as it was (the test mocks `useState` by hook order and reads the setters). Only the import call moved: `Effect.runFork` of a `tryPromise` with `matchEffect` (the same setters on success and failure) and `ensuring` (busy flag cleared on every exit). `useAction` was not used because its state would bypass the setters the existing test checks.
- Behaviour differences: none in texts, order of side effects, or the errors each caller sees. Permission prompts still start from the press handler, through the same `requestMediaLibraryPermissionsAsync` call.
- Unsure, 1: Effect runs a step a little differently from `async` (scheduling), so a microtask-level ordering could differ. No test depends on it; the tests pass.
- Unsure, 2: in `sizeOfEffect`, a `getInfo` that resolves to `null` (not possible with expo's `getInfoAsync`) now rejects instead of returning `undefined`. Kept as a `map`; say if you want it wrapped.
- Unsure, 3: the import in the sheet, like the old promise chain, is not interrupted on unmount (no timers here). The `setState` after unmount is the same as before.
- Not run (wave mode): whole suite, `pnpm gate`, `phone:smoke`.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** No new tests (test files not allowed); the 36 sticker tests pass unchanged.
- **Phone:** the wave branch is smoked on the emulator after the merge.

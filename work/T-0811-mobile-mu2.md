---
id: T-0811
title: "MU2: mobile lib basics: approval-state, auth, blocked-users, polyfills, session-token, stickers-storage, stickers, emoji-data on Effect"
status: todo
milestone: M5
branch: task/T-0811-mobile-mu2
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0811 (MU2): mobile lib basics: approval-state, auth, blocked-users, polyfills, session-token, stickers-storage, stickers, emoji-data on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU2), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/lib/approval-state.ts` (77 lines; first hit at line 33: async/await/Promise @33; try/catch @37), tested in `approval-state.test.ts`;
  - `apps/mobile/src/lib/auth.ts` (123 lines; first hit at line 22: env read @22; async/await/Promise @96), tested in `auth.test.ts`;
  - `apps/mobile/src/lib/blocked-users.ts` (114 lines; first hit at line 24: async/await/Promise @24; try/catch @25), tested in `blocked-users.test.ts`;
  - `apps/mobile/src/lib/emoji-data.ts` (425 lines; first hit at line 364: try/catch @364; JSON.parse @365; async/await/Promise @400), tested in `emoji-data.test.ts`;
  - `apps/mobile/src/lib/polyfills.ts` (50 lines; first hit at line 24: async/await/Promise @24), **no test** (write `apps/mobile/src/lib/polyfills.test.ts` first);
  - `apps/mobile/src/lib/session-token.ts` (10 lines; first hit at line 6: async/await/Promise @6), **no test** (write `apps/mobile/src/lib/session-token.test.ts` first);
  - `apps/mobile/src/lib/stickers-storage.ts` (54 lines; first hit at line 25: async/await/Promise @25; try/catch @48), tested in `stickers-storage.test.ts`;
  - `apps/mobile/src/lib/stickers.ts` (240 lines; first hit at line 83: try/catch @83; JSON.parse @134 (weak)), tested in `stickers.test.ts`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0811: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/lib/approval-state.ts`, `apps/mobile/src/lib/auth.ts`, `apps/mobile/src/lib/blocked-users.ts`, `apps/mobile/src/lib/emoji-data.ts`, `apps/mobile/src/lib/polyfills.ts`, `apps/mobile/src/lib/polyfills.test.ts`, `apps/mobile/src/lib/session-token.ts`, `apps/mobile/src/lib/session-token.test.ts`, `apps/mobile/src/lib/stickers-storage.ts`, `apps/mobile/src/lib/stickers.ts`, `work/T-0811-mobile-mu2.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/lib/approval-state src/lib/auth src/lib/blocked-users src/lib/emoji-data src/lib/polyfills src/lib/session-token src/lib/stickers-storage src/lib/stickers
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

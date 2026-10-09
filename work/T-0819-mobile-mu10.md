---
id: T-0819
title: "MU10: mobile settings A: approvals, blocked, requests, folders, folder/[id] on Effect"
status: todo
milestone: M5
branch: task/T-0819-mobile-mu10
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0819 (MU10): mobile settings A: approvals, blocked, requests, folders, folder/[id] on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU10), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/settings/approvals.tsx` (477 lines; first hit at line 86: timer @86; async/await/Promise @101; try/catch @105), **no test** (write `apps/mobile/src/components/screens/settings-approvals-screen.test.tsx` first);
  - `apps/mobile/src/app/settings/blocked.tsx` (203 lines; first hit at line 55: async/await/Promise @55; try/catch @59), **no test** (write `apps/mobile/src/components/screens/settings-blocked-screen.test.tsx` first);
  - `apps/mobile/src/app/settings/folder/[id].tsx` (292 lines; first hit at line 131: async/await/Promise @131; try/catch @132), **no test** (write `apps/mobile/src/components/screens/settings-folder-id-screen.test.tsx` first);
  - `apps/mobile/src/app/settings/folders.tsx` (185 lines; first hit at line 72: try/catch @72 (weak)), **no test** (write `apps/mobile/src/components/screens/settings-folders-screen.test.tsx` first);
  - `apps/mobile/src/app/settings/requests.tsx` (289 lines; first hit at line 63: async/await/Promise @63; try/catch @68), **no test** (write `apps/mobile/src/components/screens/settings-requests-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0819: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/settings/approvals.tsx`, `apps/mobile/src/components/screens/settings-approvals-screen.test.tsx`, `apps/mobile/src/app/settings/blocked.tsx`, `apps/mobile/src/components/screens/settings-blocked-screen.test.tsx`, `apps/mobile/src/app/settings/folder/[id].tsx`, `apps/mobile/src/components/screens/settings-folder-id-screen.test.tsx`, `apps/mobile/src/app/settings/folders.tsx`, `apps/mobile/src/components/screens/settings-folders-screen.test.tsx`, `apps/mobile/src/app/settings/requests.tsx`, `apps/mobile/src/components/screens/settings-requests-screen.test.tsx`, `work/T-0819-mobile-mu10.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/settings-approvals-screen.test.tsx src/components/screens/settings-blocked-screen.test.tsx src/components/screens/settings-folder-id-screen.test.tsx src/components/screens/settings-folders-screen.test.tsx src/components/screens/settings-requests-screen.test.tsx
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

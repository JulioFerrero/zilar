---
id: T-0818
title: "MU9: mobile group and AI screens: group/[id], ais/[id], ais/new on Effect"
status: merged
milestone: M5
branch: task/T-0818-mobile-mu9
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0818 (MU9): mobile group and AI screens: group/[id], ais/[id], ais/new on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU9), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/ais/[id].tsx` (345 lines; first hit at line 84: async/await/Promise @84; try/catch @101), **no test** (write `apps/mobile/src/components/screens/ais-id-screen.test.tsx` first);
  - `apps/mobile/src/app/ais/new.tsx` (366 lines; first hit at line 68: async/await/Promise @68; try/catch @72), **no test** (write `apps/mobile/src/components/screens/ais-new-screen.test.tsx` first);
  - `apps/mobile/src/app/group/[id].tsx` (720 lines; first hit at line 1: native module import @1; try/catch @138; async/await/Promise @204; timer @309), **no test** (write `apps/mobile/src/components/screens/group-id-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0818: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/ais/[id].tsx`, `apps/mobile/src/components/screens/ais-id-screen.test.tsx`, `apps/mobile/src/app/ais/new.tsx`, `apps/mobile/src/components/screens/ais-new-screen.test.tsx`, `apps/mobile/src/app/group/[id].tsx`, `apps/mobile/src/components/screens/group-id-screen.test.tsx`, `work/T-0818-mobile-mu9.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/ais-id-screen.test.tsx src/components/screens/ais-new-screen.test.tsx src/components/screens/group-id-screen.test.tsx
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

- effect:map kind after: `apps/mobile/src/app/ais/[id].tsx` effect, `apps/mobile/src/app/ais/new.tsx` effect, `apps/mobile/src/app/group/[id].tsx` effect. (Before: not recorded.)
- Tests: tests-before commit 41cc6632 added 30 tests (ais-id 9, ais-new 6, group 15), all passing on the old code. After the conversion the same 30 pass, with no act warnings. The tests render the real route in jsdom (`react-dom/client`, the `use-action.test.tsx` pattern), so they do not depend on hook internals. Native modules, pickers, sheets and API hooks are stubs.
- Loads (`listAis`, connections, machines, roles, invite links, visibility) run through `useQuery` or `useAction`. Form fields fill from the answer inside an `Effect.tap`, as before.
- Writes (save, machine change, create AI, topic create, archive, pref, invite link create/revoke, visibility save) run through `useAction`. Busy and error come from the action state. Error text still goes through `describeAisError` / `describeRolesError` / `visibilitySaveError`, so each raw error keeps its class (the raw rejection is kept, not mapped to `ApiFailure`).
- Timer: the visibility handle check is a `useQuery` that sleeps 300 ms; a deps change or unmount interrupts it.
- Sheet callbacks that must return a Promise (roles writes, links copy/share, visibility bridge) use `Effect.runPromise` in the component, because the sheets are outside this task and chain `.then` on them.
- Behaviour differences:
  - `useAction` mode is `ignore`: a second run while one is waiting is dropped. Affected: save, machine change, create AI, topic create, archive/pref, invite-link create/revoke, visibility save, invite-links load. Before, a double action could run twice; the buttons were already disabled while busy, so this should not be visible.
  - Roles writes are not `useAction`: concurrent writes still run as before.
  - A failed topic create keeps the sheet open and shows the same fixed text; a failed AI add still names the AI.
  - Save/create keep "Saving…"/"Creating…" after success until the route leaves (same as before).
- Checks: `pnpm --filter @zilar/mobile exec vitest run --reporter=dot` on the 3 test files: 30 passed. `pnpm --filter @zilar/mobile exec tsc --noEmit -p .`: exit 0. `oxlint` on the 6 changed files: exit 0.
- Unsure: `Effect.runPromise` rejects with the raw Share error (`shareText`) in the same way as the old Promise (not verified on a device). Phone smoke not run (lead's wave check).

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 30 new tests. Wave check fix: the roles load keeps `setRolesLoadError(describeRolesError(error, 'load'))`, which two guard tests pin.
- **Phone:** the wave branch is smoked on the emulator after the merge.

---
id: T-0816
title: "MU7: mobile routes: explore, welcome/handle, at, u, join, invite on Effect"
status: merged
milestone: M5
branch: task/T-0816-mobile-mu7
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0816 (MU7): mobile routes: explore, welcome/handle, at, u, join, invite on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU7), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back. Julio checks the invite join on the phone before the next deploy.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/app/explore.tsx` (323 lines; first hit at line 82: timer @82; async/await/Promise @93; try/catch @101), **no test** (write `apps/mobile/src/components/screens/explore-screen.test.tsx` first);
  - `apps/mobile/src/app/at/[handle].tsx` (218 lines; first hit at line 63: timer @63; async/await/Promise @70; try/catch @75), **no test** (write `apps/mobile/src/components/screens/at-handle-screen.test.tsx` first);
  - `apps/mobile/src/app/invite/[code].tsx` (80 lines; first hit at line 28: async/await/Promise @28; try/catch @33), **no test** (write `apps/mobile/src/components/screens/invite-code-screen.test.tsx` first);
  - `apps/mobile/src/app/join/[token].tsx` (229 lines; first hit at line 119: async/await/Promise @119; try/catch @128), **no test** (write `apps/mobile/src/components/screens/join-token-screen.test.tsx` first);
  - `apps/mobile/src/app/u/[handle].tsx` (250 lines; first hit at line 75: async/await/Promise @75; try/catch @80), **no test** (write `apps/mobile/src/components/screens/u-handle-screen.test.tsx` first);
  - `apps/mobile/src/app/welcome/handle.tsx` (198 lines; first hit at line 69: timer @69; async/await/Promise @70; try/catch @111), **no test** (write `apps/mobile/src/components/screens/welcome-handle-screen.test.tsx` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0816: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/app/explore.tsx`, `apps/mobile/src/components/screens/explore-screen.test.tsx`, `apps/mobile/src/app/at/[handle].tsx`, `apps/mobile/src/components/screens/at-handle-screen.test.tsx`, `apps/mobile/src/app/invite/[code].tsx`, `apps/mobile/src/components/screens/invite-code-screen.test.tsx`, `apps/mobile/src/app/join/[token].tsx`, `apps/mobile/src/components/screens/join-token-screen.test.tsx`, `apps/mobile/src/app/u/[handle].tsx`, `apps/mobile/src/components/screens/u-handle-screen.test.tsx`, `apps/mobile/src/app/welcome/handle.tsx`, `apps/mobile/src/components/screens/welcome-handle-screen.test.tsx`, `work/T-0816-mobile-mu7.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/screens/explore-screen.test.tsx src/components/screens/at-handle-screen.test.tsx src/components/screens/invite-code-screen.test.tsx src/components/screens/join-token-screen.test.tsx src/components/screens/u-handle-screen.test.tsx src/components/screens/welcome-handle-screen.test.tsx
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

- **effect:map kinds:** `explore.tsx`, `at/[handle].tsx`, `invite/[code].tsx`, `join/[token].tsx`, `u/[handle].tsx`, `welcome/handle.tsx` are all `effect`, Tier B false (no async, await, `.then`, `.catch`, try/catch or timer left).
- **Tests:** before 0 (no tests existed). Added 6 test files in `apps/mobile/src/components/screens/`, 81 tests (explore 14, at-handle 14, invite-code 4, join-token 16, u-handle 19, welcome-handle 14). They were committed first as "T-0816: tests before" and passed on the old code; they pass after the conversion (3 runs each, no flakes). Existing tests were not touched. The `at-handle` "Opening…" case was changed after the first commit to hold the lookup with a deferred promise (it relied on timer timing); it passes on both old and new code.
- **Checks run:** the six test files together (81 passed), `pnpm --filter @zilar/mobile typecheck` (clean), `oxlint` on the changed files (clean), prettier (clean). `pnpm gate` was not run (wave mode).
- **How it was converted:** a `fromThrown(call)` helper in each file (`Effect.tryPromise` with `catch: (cause) => cause`) keeps the thrown error as it is, because the existing describe helpers (`describeDirectoryError`, `handleRouteViewFor`, `friendlyClaimError`, `addContactSendFailure`, `joinPreviewFailure`) check `instanceof DirectoryApiError` / `ContactsApiError` / `ProfileApiError` and `status`/`code`. `fromApi` would have turned those into `ApiFailure` and changed the texts. Debounced and one-shot loads are `useAction` with `mode: 'replace'` run from a `useEffect`, with `controls.interrupt` as the cleanup (replaces `active` flags and `clearTimeout`); `Effect.sleep` replaces `setTimeout`. Joins, claims, paging and profile actions are `useAction` in the default `ignore` mode. `invite/[code]` uses `useQuery`.
- **Behaviour differences:**
  - `u/[handle]`: the load now uses `replace`, so a slower old lookup (Retry or refocus while loading) no longer overwrites a newer one. Before, the last answer to arrive won.
  - `u/[handle]`: the profile action's busy flag is the action's waiting state, not a ref plus a `useState`. A press while an action runs is dropped as before; the error clears only when the action actually starts (before, only when it passed the guard too).
  - `join/[token]`, `at/[handle]`, `explore` joins and `u/[handle]` actions: leaving the screen while a join, claim or action is in flight now interrupts it (before, the promise ran on and could still navigate or set state). The request itself still goes out.
  - Otherwise none: same texts, same order of state updates, same 300 ms and 0 ms delays.
- **Unsure:** the `useAction` fiber runs `setState` from `Effect.sync` after unmount only if the fiber is not interrupted; React ignores that. I checked behaviour in jsdom with mocked native components only; the lead's `pnpm phone:smoke` and Julio's invite check on the phone cover the real device. In `join/[token]` I kept `previewJoinLink` in the effect deps as before.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Sonnet 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 81 new screen tests. Leaving a screen mid-join skips only that screen's follow-up; the request still goes out.
- **Phone:** the wave branch is smoked on the emulator after the merge.

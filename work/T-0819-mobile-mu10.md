---
id: T-0819
title: "MU10: mobile settings A: approvals, blocked, requests, folders, folder/[id] on Effect"
status: merged
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

- Commits: `fb93e035` "T-0819: tests before" (five new screen tests, on the old code); the conversion commit follows it (see git log).
- `effect:map` kinds (after): `app/settings/approvals.tsx` effect, `app/settings/blocked.tsx` effect, `app/settings/folder/[id].tsx` effect, `app/settings/folders.tsx` effect, `app/settings/requests.tsx` effect.
- Tests: 0 existing tests for these five files. New tests: 43 in five files (approvals 12, blocked 7, requests 9, folders 6, folder/[id] 9). All 43 pass on the old code (before) and on the converted code (after). Run 3 times, no flakes.
- Typecheck: `pnpm --filter @zilar/mobile typecheck` clean (exit 0).
- Checks run (wave mode): the five test files with `--reporter=dot`, and the mobile typecheck. Not run: `pnpm gate`, the whole suite, lint (lead's combined check).
- Shape of the conversion: the local state of each screen is kept (same texts, same JSX). Each async call is an Effect inside `useAction` (`@/lib/effect/use-action`), with `busy` taken from `isWaiting`. Helpers in `components/contacts/*`, `components/approvals/rows.ts` and the store are still Promises (not my files), wrapped with `Effect.promise` or `Effect.tryPromise`.
- Behaviour differences:
  - blocked: Unblock busy is per row (one `useAction` per `BlockedRow`). Before, one unblock blocked every other row's tap; now the other rows stay tappable while one runs. The reload is `mode: 'replace'`: a focus refresh replaces a load still running (before, both ran).
  - requests: Accept / Decline / Cancel busy is per row (one `useAction` per `RequestRow`). Same as blocked: before, one action at a time across all rows. Reload is `mode: 'replace'`.
  - folders: reorder is one `useAction` with `mode: 'ignore'`, the same one-at-a-time rule as before.
  - folder/[id]: Save and Delete are two `useAction`s; `busy` is `isWaiting(save) || isWaiting(remove)`, as before. Labels unchanged.
  - approvals: `load` is `mode: 'replace'` (a focus refresh replaces a load in flight; before both ran and the last to finish won). The notice (4 s) is a `useAction` with `mode: 'replace'`: `Effect.sleep` replaces `setTimeout`, and unmounting interrupts it, as the old `clearTimeout` did. The 60 s clock is `Effect.forever(Effect.sleep(60s))` in an action, interrupted on unmount; it first ticks after 60 s, as `setInterval` did. Each pending row has its own decision action; the per-id `claimDecision` guard is kept. Revoke is one action with `mode: 'ignore'`, which replaces `revokingRef`. The rules fan-out uses `Effect.forEach` (unbounded) and the same `mergeRulesFanOut`, so the result is the same, including the fixed "Could not load the rules." text.
  - Removed local state: blocked `busyId` (and `busyRef`), requests `busyId` (and `busyRef`), folders `busy`, folder/[id] `busy`, approvals `revokingRule` and the notice timer ref.
  - Messages: all user-facing texts are unchanged. The raw `Error.message` paths are unchanged (approvals load error and revoke error still use `error.message` as before).
- Test changes after the "tests before" commit (not on the old code any more): folder/[id] test: `confirmingDelete` moved from forced index 7 to 6 (the `busy` state is gone, so the list is one shorter); and the test's `ChatFoldersApiError` mock now takes `(status, code, message)` like the real class (typecheck caught it). Nothing else in the tests changed.
- Unsure:
  - The tests run the screens through `renderToStaticMarkup` with the `useState` forced in order, so the effects themselves do not run in the tests. The press handlers are called and the API calls and setter calls are checked after a flush. The timer and per-row action behaviour at runtime is not covered by a test; it needs `pnpm phone:smoke` for the wave.
  - The `useState` forced-value mock depends on the order of the screen's `useState` calls. After this change the remaining order is: blocked (people, status, error), requests (incoming, outgoing, status, error), folders (error), folder/[id] (name, icon, types, mute, read, error, confirm), approvals (rows ... confirmRule, revokeError, refreshing).
  - Lint not run (wave mode). Watch for unused-parameter names like `_` in `useAction((_: void) => …)`.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 43 new tests. Unblock and request actions are busy per row instead of screen-wide.
- **Phone:** the wave branch is smoked on the emulator after the merge.

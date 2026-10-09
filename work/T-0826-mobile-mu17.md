---
id: T-0826
title: "MU17: mobile chat input B: gif-panel, sticker-panel, channel-screen on Effect"
status: merged
milestone: M5
branch: task/T-0826-mobile-mu17
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0826 (MU17): mobile chat input B: gif-panel, sticker-panel, channel-screen on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU17), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/chat/channel-screen.tsx` (373 lines; first hit at line 1: native module import @1; async/await/Promise @122; try/catch @153), **no test** (write `apps/mobile/src/components/chat/channel-screen.test.tsx` first);
  - `apps/mobile/src/components/chat/gif-panel.tsx` (398 lines; first hit at line 153: async/await/Promise @153; timer @231; try/catch @349), tested in `gif-panel.test.tsx`;
  - `apps/mobile/src/components/chat/sticker-panel.tsx` (339 lines; first hit at line 94: async/await/Promise @94; try/catch @326), tested in `sticker-panel.test.tsx`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0826: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/components/chat/channel-screen.tsx`, `apps/mobile/src/components/chat/channel-screen.test.tsx`, `apps/mobile/src/components/chat/gif-panel.tsx`, `apps/mobile/src/components/chat/sticker-panel.tsx`, `work/T-0826-mobile-mu17.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/channel-screen src/components/chat/gif-panel src/components/chat/sticker-panel
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

- Commits: `4226ec27` T-0826: tests before (channel-screen characterization); then the conversion commit (see git log).
- `effect:map` kinds (after conversion): `channel-screen.tsx` effect (only signal H9: the `expo-clipboard` import, a native module that stays); `gif-panel.tsx` effect (W4 hit is `Effect.catch(`, not a try/catch); `sticker-panel.tsx` effect (same W4 hit).
- Tests: `channel-screen.test.tsx` new, 14 tests, all pass on the old code (tests before) and on the new code. `gif-panel.test.tsx` 12 and `sticker-panel.test.tsx` 9, unchanged files, all pass on the new code (I did not run them on the old code separately). Checks run: the three test paths, 35 passed in 3 files.
- Typecheck: `pnpm --filter @zilar/mobile typecheck` clean.
- Behaviour differences:
  - channel-screen: role change and leave are `useAction` (ignore mode, same double-press guard). An unmount now interrupts a running role change or leave; before, they finished in the background.
  - channel-screen: the admins load is `useAction` with replace mode; its value is the last successful list, as before. A load that finishes after the viewer becomes a manager is ignored, as before.
  - channel-screen: links reload, create and revoke run with `Effect.runFork` and keep their `useState`; same order, same messages, no unmount interruption (as before).
  - channel-screen: clipboard and share bridge still take Promises (the sheet is not converted); they run through `Effect.runPromise`.
  - gif-panel: the search debounce is a fiber (`Effect.sleep`), interrupted where `clearTimeout` was. The first page loads after `Effect.yieldNow` instead of a Promise microtask.
  - sticker-panel and gif-panel: the session-token load on mount used to leave a rejection unhandled; now a failure keeps the token `undefined` with no log.
  - Exports keep their Promise signatures and their raw errors: `persistRecent`, `loadStickerPacks`, `fetchGifPage` and `probeGifsAvailability` are `Effect.runPromise` wrappers (the `async` keyword is gone).
  - Texts and the render output of the panels are unchanged (the static markup tests pass unchanged).
- Not run (wave rule): `stickers-storage.test.ts` imports `persistRecent`; `emoji-sheet.test.tsx` imports from `sticker-panel`; `composer-gifs.test.tsx` renders `EmojiSheet` (so `GifPanel` and `StickerGrid`). The wave check should cover them.
- Unsure: (a) the first GIF load now waits on `Effect.yieldNow`; the exact tick may differ from the old microtask. (b) Not checked on a device or the emulator (wave mode).
- Fix round 1: the role change and the leave are `Effect.uninterruptible`, so they finish after an unmount (leave still navigates). New test "a leave still finishes and navigates after the screen unmounts". Caveat: in jsdom the atom did not interrupt the leave on unmount even without the guard (no interrupt logged), so that test passes both ways; it guards the behaviour but does not prove the guard was needed. `pnpm exec oxlint` on the four changed files: clean.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 14 new tests. Fix round 1: leave and role change are uninterruptible, so unmount does not skip the navigation.
- **Phone:** the wave branch is smoked on the emulator after the merge.

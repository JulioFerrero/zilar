---
id: T-0830
title: "MU21: mobile chat list: message-bubble, message-list, sticker-message on Effect"
status: merged
milestone: M5
branch: task/T-0830-mobile-mu21
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0830 (MU21): mobile chat list: message-bubble, message-list, sticker-message on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU21), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/chat/message-bubble.tsx` (744 lines; first hit at line 8: native module import @8; try/catch @360), **no test** (write `apps/mobile/src/components/chat/message-bubble.test.tsx` first);
  - `apps/mobile/src/components/chat/message-list.tsx` (361 lines; first hit at line 202: timer @202), tested in `message-list.test.tsx`;
  - `apps/mobile/src/components/chat/sticker-message.tsx` (92 lines; first hit at line 43: async/await/Promise @43), tested in `sticker-message.test.tsx`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0830: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/components/chat/message-bubble.tsx`, `apps/mobile/src/components/chat/message-bubble.test.tsx`, `apps/mobile/src/components/chat/message-list.tsx`, `apps/mobile/src/components/chat/sticker-message.tsx`, `work/T-0830-mobile-mu21.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/message-bubble src/components/chat/message-list src/components/chat/sticker-message
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

Commits: `ac488ef1` T-0830: tests before (new `message-bubble.test.tsx`); then the conversion commit.

- **effect:map kinds** (`pnpm effect:map`, data.json):
  - `apps/mobile/src/components/chat/message-bubble.tsx`: `effect` (tier B: the expo-haptics and expo-clipboard imports stay, signal H9, as the spec says).
  - `apps/mobile/src/components/chat/message-list.tsx`: `effect`, no signals.
  - `apps/mobile/src/components/chat/sticker-message.tsx`: `effect`, no signals.
- **Tests:** before the conversion the three targeted sets ran 6 files, 30 tests (25 existing + 5 new in `message-bubble.test.tsx`, all passing). After: 6 files, 30 tests, all passing. No existing test was changed.
- **Typecheck:** `pnpm --filter @zilar/mobile typecheck` is clean (`tsc --noEmit`, no output).
- **Conversion:**
  - message-bubble: the Haptics call in `openMenu` and the Clipboard call in the menu's Copy go through `Effect.runFork(Effect.tryPromise(...).pipe(Effect.ignore))`, started synchronously in the press handler (the tests check the native calls right after the press).
  - message-list: the four scroll timers, the pin-jump timer and the `onScrollToIndexFailed` retry use a small `runLater` helper (`Effect.sleep` in a forked fiber). The cleanups use `Effect.runSync(Fiber.interrupt(...))`, as `clearTimeout` did. Delays are unchanged.
  - sticker-message: `getSessionToken().then(...)` with the `cancelled` flag became `Effect.runFork(Effect.promise(...))`. Cleanup interrupts the fiber.
- **Behaviour differences:**
  - Copy: a rejected clipboard write was an unhandled promise rejection before. It is now ignored silently (`Effect.ignore`). The user sees nothing either way.
  - Sticker token: a rejected `getSessionToken()` was an unhandled rejection. It is now a defect inside an unobserved fiber. Unsure whether Effect logs it.
  - Everything else is the same: texts, delays, the order of native calls and the `cancelled` semantics.
- **Not covered by a test:** the sticker token read, the list timers and the haptic/copy wiring inside a real render. The tests use `renderToStaticMarkup`, which does not run effects. The wave phone smoke should check the sticker image loads and the scroll-to-unread/jump behaviour.
- **Unsure:** whether `Effect.runFork` of a `tryPromise` starts the native call synchronously in every case. The bubble tests show it does on this Effect 4.0.2 build. Also, `Effect.promise` for the token read is a judgement call (`tryPromise` plus `Effect.ignore` would be the other choice).

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Haiku 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 5 new bubble tests. Phone check wanted: sticker image load, scroll-to-unread and jump.
- **Phone:** the wave branch is smoked on the emulator after the merge.

---
id: T-0825
title: "MU16: mobile chat input A: composer, channel-composer-bar, new-chat-button on Effect"
status: merged
milestone: M5
branch: task/T-0825-mobile-mu16
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0825 (MU16): mobile chat input A: composer, channel-composer-bar, new-chat-button on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU16), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back. Julio checks sending on the phone before the next deploy.

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/components/chat/channel-composer-bar.tsx` (141 lines; first hit at line 111: try/catch @111 (weak)), **no test** (write `apps/mobile/src/components/chat/channel-composer-bar.test.tsx` first);
  - `apps/mobile/src/components/chat/composer.tsx` (697 lines; first hit at line 274: async/await/Promise @274; try/catch @283; env read @294), **no test** (write `apps/mobile/src/components/chat/composer.test.tsx` first);
  - `apps/mobile/src/components/chat/new-chat-button.tsx` (269 lines; first hit at line 87: async/await/Promise @87; try/catch @125), tested in `new-chat-button.test.tsx`;
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0825: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/components/chat/channel-composer-bar.tsx`, `apps/mobile/src/components/chat/channel-composer-bar.test.tsx`, `apps/mobile/src/components/chat/composer.tsx`, `apps/mobile/src/components/chat/composer.test.tsx`, `apps/mobile/src/components/chat/new-chat-button.tsx`, `work/T-0825-mobile-mu16.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/components/chat/channel-composer-bar src/components/chat/composer src/components/chat/new-chat-button
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

- **effect:map kinds:** `channel-composer-bar.tsx` effect (no signals), `new-chat-button.tsx` effect (no signals), `composer.tsx` effect (one weak signal left: W7, the `process.env.EXPO_PUBLIC_ZILAR_MOCK` read; `apps/mobile/src/mock/gate.ts` has no constant for it and is not an Allowed file, so the read stays as the spec allows).
- **Tests:** tests first committed as "T-0825: tests before" (`composer.test.tsx` 18 tests, `channel-composer-bar.test.tsx` 7 tests, jsdom, RN primitives and the two sheets mocked; they pass on the old and the new code). Check run (3 files plus their neighbours, 6 test files): 34 tests before my tests, 59 with them, 59 after the conversion, 60 after fix round 1 (one new GIF test), run 3 times, all green. Mobile typecheck clean; oxlint clean on the five files.
- **What changed:**
  - `channel-composer-bar.tsx`: the mute toggle is one `useAction`; busy is `isWaiting`, the fixed sentence shows from the failure.
  - `composer.tsx`: one `step()` helper (`Effect.tryPromise` with a typed `ComposerStepFailed`) and `useAction` for sticker load, sheet open reads and GIF probe, emoji and sticker recents, and attachment pick; GIF picks run as one fiber each. `attachBusy` is now `isWaiting` of the pick action. The picker call starts inside the tap (a test checks the picker is called synchronously after the press).
  - `new-chat-button.tsx`: channel and group create are `useAction` with busy and error derived from the state (`createErrorText` still gets the original error, kept in `CreateFailed.reason`); the clipboard and share callbacks are Effects run with `runMobile` and still return Promises, rejecting with the original error.
- **Behaviour differences:**
  - Composer `mode: 'replace'` on sticker load, sheet reads and emoji/sticker recents: a newer call interrupts an older one that is still running, so a stale response no longer overwrites a newer one.
  - GIF pick (fix round 1): each pick runs as its own `Effect.runFork` fiber, so two picks while the first download is still running both send, as before. The fibers are interrupted on unmount. A test covers it.
  - Composer attachment pick uses mode `ignore`: a second pick while one runs is dropped (the sheet already shows busy).
  - Channel mute and the create sheets use mode `ignore` (a second tap while busy is dropped, as the old `busy` guard did).
  - Unmounting now interrupts a running load, pick or create (before, it kept running and set state on an unmounted component).
  - The create error text shows only while no create is running (it cleared on retry before too); closing and reopening a dialog after a failure still shows the old error, as before.
  - Otherwise none: same texts, same order of side effects.
- **Unsure / not covered:** `new-chat-button.test.tsx` is not an Allowed file, so the create flows and the invite copy/share are not covered by a committed test. I checked them with a temporary jsdom test (channel and group create, busy, fixed error texts, navigation, clear on retry, clipboard and share success and rejection with the original error), which I deleted before committing. I did not run the phone; the lead's `phone:smoke` should check sending a message, a sticker, a GIF, attaching a file and creating a channel.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Sonnet 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** 25 new tests. Fix round 1: every GIF pick sends, as before (own fiber per pick); stale loads still use replace.
- **Phone:** the wave branch is smoked on the emulator after the merge.

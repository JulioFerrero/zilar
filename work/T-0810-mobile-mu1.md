---
id: T-0810
title: "MU1: mobile auth: AuthFlow, NameForm, session storage, session store, session on Effect"
status: merged
milestone: M5
branch: task/T-0810-mobile-mu1
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0810 (MU1): mobile auth: AuthFlow, NameForm, session storage, session store, session on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task MU1), accepted by Julio on 2026-10-09. It runs in **wave 2** of the batch mode: the lead checks the whole wave once and sends every failure back. Julio signs in on the phone before the next deploy (login risk).

### Verified facts (do not re-derive)
- **The files**, with each first non-Effect line from the plan appendix (re-read the file, because lines move):
  - `apps/mobile/src/auth/AuthFlow.tsx` (222 lines; first hit at line 48: timer @48; async/await/Promise @54), tested in `AuthFlow.test.tsx`;
  - `apps/mobile/src/auth/NameForm.tsx` (99 lines; first hit at line 28: async/await/Promise @28), **no test** (write `apps/mobile/src/auth/NameForm.test.tsx` first);
  - `apps/mobile/src/auth/secure-session-storage.ts` (26 lines; first hit at line 1: native module import @1; async/await/Promise @14), **no test** (write `apps/mobile/src/auth/secure-session-storage.test.ts` first);
  - `apps/mobile/src/auth/session-storage.ts` (23 lines; first hit at line 12: async/await/Promise @12), **no test** (write `apps/mobile/src/auth/session-storage.test.ts` first);
  - `apps/mobile/src/auth/session-store.ts` (143 lines; first hit at line 79: async/await/Promise @79; try/catch @81), tested in `session-store.test.ts`;
  - `apps/mobile/src/auth/session.ts` (70 lines; first hit at line 18: try/catch @18; async/await/Promise @23), **no test** (write `apps/mobile/src/auth/session.test.ts` first);
- **The mobile Effect toolkit** (T-0800) is in `apps/mobile/src/lib/effect/`: `runtime.ts` (`runMobile`, `mobileAtomRuntime`), `errors.ts` (`ApiFailure`, `toApiFailure`), `api-effect.ts` (`fromApi`), `use-action.ts` and `use-query.ts`. They have the same API as the web hooks; read their header comments.
- **Mobile API modules** (`apps/mobile/src/lib/*-api.ts`) throw per-module errors with `status`, `code` and `message`; `fromApi` maps them to `ApiFailure`.
- **Native modules** (expo-*, react-native APIs) stay imported; their calls are wrapped with `Effect.tryPromise`, `Effect.try` or `Effect.callback`.
- **Expo inlines only a literal `process.env.EXPO_PUBLIC_*`.** Since R5 (T-0803), the mock env comes from `apps/mobile/src/mock/gate.ts`; if a file here still reads `process.env`, import from there when the constant exists, or leave the read (W7) and say so.

### What to build
1. **Tests first:** for each file marked "no test", write its test against the current code. Render it with the existing mocks the neighbouring tests use, and cover what it shows and its main actions' success and failure. A test for a screen under `src/app/` goes in `apps/mobile/src/components/screens/` (Expo Router makes every file in `src/app` a route) and imports the screen, the way `apps/mobile/src/components/stickers/stickers-screen.test.tsx` does. Commit them as "T-0810: tests before".
2. Convert the listed files.

Use the rules in `docs/EFFECT_BRIEF.md` (Web UI applies to React Native too): `useAction` per row, store `Error` messages kept, the same texts and behaviour, timers as `Effect.sleep` or `Schedule` fibers interrupted on unmount, and permission prompts (microphone, camera, notifications) still started directly from the press handler.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, every file in `apps/mobile/src/lib/effect/`, the listed files and their tests.

### Allowed files
`apps/mobile/src/auth/AuthFlow.tsx`, `apps/mobile/src/auth/NameForm.tsx`, `apps/mobile/src/auth/NameForm.test.tsx`, `apps/mobile/src/auth/secure-session-storage.ts`, `apps/mobile/src/auth/secure-session-storage.test.ts`, `apps/mobile/src/auth/session-storage.ts`, `apps/mobile/src/auth/session-storage.test.ts`, `apps/mobile/src/auth/session-store.ts`, `apps/mobile/src/auth/session.ts`, `apps/mobile/src/auth/session.test.ts`, `work/T-0810-mobile-mu1.md`.

### Checks (wave mode: your own tests and the mobile typecheck only; no whole suite, no `pnpm gate`)
```bash
pnpm --filter @zilar/mobile exec vitest run --reporter=dot src/auth/AuthFlow src/auth/NameForm src/auth/secure-session-storage src/auth/session-storage src/auth/session-store src/auth/session
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

- Commits: `T-0810: tests before` (new tests on the old code), then the conversion commit.
- effect:map kinds: `AuthFlow.tsx` effect, `NameForm.tsx` effect, `session-store.ts` effect, `session.ts` effect, `session-storage.ts` effect, `secure-session-storage.ts` effect (Tier B, signal H9: it still imports `expo-secure-store`, a native module).
- Tests (the Checks command, 6 files): before the conversion 48 passed (existing 12: AuthFlow 3, session-store 9; new 36: NameForm 9, secure-session-storage 8, session-storage 5, session 14); after the conversion 48 passed, same tests, no existing test edited. Mobile typecheck: clean.
- Not done: `AuthFlow.test.tsx` and `session-store.test.ts` are not in Allowed files, so AuthFlow's actions (send code, verify, countdown) have no committed test. I checked them once with a scratch jsdom test (deleted, not committed): send code shows "Resend in 30s", counts 29 and 28 after about 1 s each, verify calls `signIn` and routes to `/welcome/name?from=%2F`, a rejected send shows the generic message and re-enables the button.
- How: storage and store are Effects exported as the same Promise functions through `runMobile` (a rejection still reaches the caller as the original error object, checked on 4.0.2). `session.ts` fire-and-forget token write is `Effect.runFork(Effect.ignore(...))`. AuthFlow and NameForm use `useAction` (busy = isWaiting); the resend countdown is `useQuery` with one `Effect.sleep(1000)` per `secondsLeft`, interrupted on change or unmount (same timing as the old interval recreated each tick). `attempt` (a `tryPromise` that keeps the original error) is repeated in session.ts, session-store.ts and secure-session-storage.ts because only these files are allowed.
- Behaviour differences:
  1. AuthFlow: if `requestSignInCode` or `signIn` rejects (network throw), the screen now shows "Something went wrong. Try again." and unlocks the form. Before, the rejection was unhandled and `busy` stayed true forever (form locked).
  2. NameForm: if `setName` rejects (e.g. secure store read fails), it now shows "Could not save your name. Try again." Before: unhandled rejection and a locked form.
  3. `busy` now turns on at the next render after the press (derived from the action state) instead of synchronously; a repeat press of the same action is ignored in between by the useAction "ignore" mode.
  4. `session.ts` `sendCode` / `signOut` and the storages: none (errors, order and texts the same).
- Unsure: `process.env` reads are not in these files (the API url read is in `lib/auth.ts`, out of scope). The no-test-edit rule left AuthFlow's own actions covered only by the scratch check above.

## Review (written by Claude)

**2026-10-09, lead:** approved (wave 2). Worker: Sonnet 5.5. The lead reviewed the Report.
- **Combined check:** all 25 wave 2 branches together pass lint, typecheck and the full mobile suite (`lead batch check`, report 20261009T172300Z). The remaining failures were server and web tests that pass on main, caused by load.
- **This task:** Auth flow, name form and session files converted; texts and session order unchanged.
- **Phone:** the wave branch is smoked on the emulator after the merge.

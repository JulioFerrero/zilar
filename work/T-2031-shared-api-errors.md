---
id: T-2031
title: "Share W1-c: toApiFailure (shape check, accepts everything web's instanceof does), isApiFailureCode and runApiAbortable (abort before, during, after → AbortError) move to client-core — web and phone errors.ts become re-exports, web callApiAbortable and phone searchMessages use runApiAbortable — fewer lines, with tests"
status: merged
milestone: M5
branch: task/T-2031-shared-api-errors
model: deepseek/deepseek-flash
effort: default
estimate: 35 min
---

# T-2031: Shared API errors and abortable call (share plan W1-c)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-18: share functions between web and phone to reduce code. `docs/audit/share-plan.md` §2.11 and slice **W1-c** found that the API error mapping and the abortable-call wrapper are written twice. They sit under every API call on both apps, auth included, so tests are required.

### Facts (read by the lead on 2026-10-18 at `bb0a94a8a`)
- **The shared types today.**
  - `packages/client-core/src/errors.ts` (13 lines) has only the `ApiFailure` tagged error.
  - `packages/client-core/src/api-effect.ts` (13 lines) has `makeFromApi(toApiFailure)`.
  - `packages/client-core/src/index.ts` exports them at `:1` (`export { makeFromApi } from './api-effect';`) and `:10` (`export { ApiFailure } from './errors';`).
- **Web.** `apps/web/src/lib/effect/errors.ts` (29 lines):
  - `toApiFailure` uses `cause instanceof ApiError` (`:13-23`);
  - `isApiFailureCode` (`:26-29`).
  - This file has about 61 importers.
- **Phone.** `apps/mobile/src/lib/effect/errors.ts` (38 lines):
  - `toApiFailure` is a shape check (`:18-30`): a numeric `status`, a string `code` and `message`, and a record `detail`, or `{}`. This accepts everything web's version does;
  - `isApiFailureCode` (`:35-38`), the same as web's.
- **The abortable call is the same in both:** web `callApiAbortable` (`apps/web/src/lib/effect/api-client.ts:52-84`) and phone `searchMessages` (`apps/mobile/src/lib/search-api.ts:49-97`). Each:
  1. throws `DOMException('Aborted','AbortError')` when the signal is already aborted;
  2. runs `Effect.runPromise(..., { signal })`;
  3. turns a failure into an `AbortError` when the signal fired;
  4. checks again after success.

### Steps
1. **errors.ts.** In `packages/client-core/src/errors.ts`, add:
   - `toApiFailure(cause)` with the **phone's** shape check;
   - `isApiFailureCode(code)`;
   - `fromApi = makeFromApi(toApiFailure)`. Import `makeFromApi` from `./api-effect`; watch for an import cycle and move `fromApi` into `api-effect.ts` if needed.
2. **api-effect.ts.** In `packages/client-core/src/api-effect.ts`, add `runApiAbortable<A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A>`, doing steps 1–4 above.
3. **The barrel.** Edit the **existing** lines `:1` and `:10` of `packages/client-core/src/index.ts` to also export the new names. **Don't add lines at the end of the file:** other tasks append there.
4. **Web.**
   - `apps/web/src/lib/effect/errors.ts` becomes re-exports of `ApiFailure`, `toApiFailure` and `isApiFailureCode` from `@zilar/client-core`, so importers don't change.
   - `callApiAbortable` in `apps/web/src/lib/effect/api-client.ts` becomes one `runApiAbortable(Effect.mapError(Effect.suspend(() => call(zilarClient())), toApiError), signal)` call.
5. **Phone.**
   - `apps/mobile/src/lib/effect/errors.ts` becomes re-exports in the same way.
   - `searchMessages` in `apps/mobile/src/lib/search-api.ts` uses `runApiAbortable`, and its local `abortError` goes.
6. **Tests** in a new `packages/client-core/src/errors.test.ts`:
   - `toApiFailure` with:
     - an `ApiError`-like class instance (keeps its fields);
     - a plain look-alike object;
     - a plain `Error` (generic `unknown_error`, and the thrown text isn't kept);
     - `null`;
     - a non-record `detail` (becomes `{}`);
   - `runApiAbortable`:
     - aborted before: it rejects with an `AbortError` and the effect never runs;
     - aborted during: it rejects with an `AbortError`;
     - success, then aborted: it rejects with an `AbortError`;
     - a normal failure keeps the mapped error.
7. **Fewer lines.** Product lines across the six app and package files must go down; put the before and after counts in the Report. Every file stays at or under 400 lines.

### Allowed files
- `packages/client-core/src/errors.ts`
- `packages/client-core/src/errors.test.ts`
- `packages/client-core/src/api-effect.ts`
- `packages/client-core/src/index.ts`
- `apps/web/src/lib/effect/errors.ts`
- `apps/web/src/lib/effect/api-client.ts`
- `apps/mobile/src/lib/effect/errors.ts`
- `apps/mobile/src/lib/search-api.ts`
- `work/T-2031-shared-api-errors.md`

### Checks
```bash
pnpm --filter @zilar/client-core exec vitest run src/errors.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The tests pass, and the gate passes.
- Product lines go down.

---

## Report (written by the worker when done)

### What I did
- `packages/client-core/src/errors.ts`: added `toApiFailure` with the phone's shape check, `isApiFailureCode`, and `fromApi = makeFromApi(toApiFailure)`. The import from `./api-effect` is not a runtime cycle: `api-effect.ts` imports `ApiFailure` as a type only.
- `packages/client-core/src/api-effect.ts`: added `runApiAbortable(effect, signal)` (abort before, during and after the Effect, plus a normal failure kept).
- `packages/client-core/src/index.ts`: extended the existing `:1` and `:10` export lines with `runApiAbortable` and `fromApi` / `toApiFailure` / `isApiFailureCode`; no new lines at the end.
- `apps/web/src/lib/effect/errors.ts` and `apps/mobile/src/lib/effect/errors.ts`: now one-line re-exports of `ApiFailure`, `toApiFailure` and `isApiFailureCode` from `@zilar/client-core`, so all ~61 importers stay unchanged.
- `apps/web/src/lib/effect/api-client.ts`: `callApiAbortable` delegates to `runApiAbortable(Effect.mapError(Effect.suspend(() => call(zilarClient())), toApiError), signal)`.
- `apps/mobile/src/lib/search-api.ts`: `searchMessages` uses `runApiAbortable`; the local `abortError`/`isAborted` code is gone.
- New `packages/client-core/src/errors.test.ts` covers `toApiFailure` (class instance, plain look-alike, plain `Error`, `null`, non-record `detail`), `isApiFailureCode`, and `runApiAbortable` (aborted before, during, after; normal failure kept; success).
- Product lines across the six app/package files: 275 before → 246 after (−29). Per file: client-core `errors.ts` 13→52, `api-effect.ts` 13→42, web `errors.ts` 29→1, web `api-client.ts` 84→69, mobile `errors.ts` 38→1, mobile `search-api.ts` 98→81. Every file is under 400 lines.

### Checks run
- `pnpm --filter @zilar/client-core test --maxWorkers=2 --reporter=dot src/errors.test.ts` — 1 file passed, 11 tests passed, 0 failed.
- `pnpm gate` (repo root) — first run failed only on `format` for `apps/web/src/lib/effect/api-client.ts` and `packages/client-core/src/errors.test.ts`; I ran `pnpm exec prettier --write` on those two files. Second run:
  ```
  PASS  install (frozen)  (1.6s)
  PASS  format  (0.7s)
  PASS  lint  (1.5s)
  PASS  typecheck  (5.0s)
  PASS  effect  (0.7s)
  PASS  build @zilar/server  (0.4s)
  PASS  tests @zilar/client-core  (1.8s)
  PASS  tests @zilar/mobile  (1.8s)
  SKIP tests @zilar/web (no nearby test files)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  images: every workspace package an app image needs is copied into its Dockerfile
  size: every changed source file is within 400 lines
  GATE PASS
  ```
- Gate reported 9 changed files against `main`, all inside the Allowed files.

### Notes for the lead
- `fromApi` now also lives in `packages/client-core/src/errors.ts` and is exported from the barrel. `apps/web/src/lib/effect/api-effect.ts` and `apps/mobile/src/lib/effect/api-effect.ts` still build their own `fromApi` with `makeFromApi(toApiFailure)`; they are outside the Allowed files and now consume the shared `toApiFailure`, so behaviour is unchanged. A later slice can make them one-line re-exports.
- No deviations from the spec. No secrets, routes, permissions or migrations touched.

## Review (written by Claude)

Approved; the pre-review was clean, with 2 follow-ups.
- **What changed.**
  - client-core now owns `toApiFailure` (a shape check), `isApiFailureCode`, `fromApi` and `runApiAbortable`.
  - Both app `effect/errors.ts` files are one-line re-exports.
  - Web `callApiAbortable` and phone `searchMessages` use `runApiAbortable`.
- **Tests** cover the failure mapping and abort before, during and after a call.
- **Size.** Product lines went from 275 to 246, which is −29.
- **Follow-ups, for a later slice:**
  - phone `gifs-api.ts` should use `runApiAbortable`;
  - both app `api-effect.ts` files should re-export the shared `fromApi`.

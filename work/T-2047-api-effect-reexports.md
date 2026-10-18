---
id: T-2047
title: "Share follow-up (T-2031): web and phone lib/effect/api-effect.ts re-export client-core's ready fromApi instead of rebuilding it, and the phone's GIF search uses runApiAbortable instead of its own abort wrapper — same behaviour, fewer lines"
status: merged
milestone: M5
branch: task/T-2047-api-effect-reexports
model: deepseek/deepseek-flash
effort: default
estimate: 20 min
---

# T-2047: The `fromApi` re-exports and the GIF search abort (T-2031 follow-ups)

## Spec (written by Claude, do not edit)

### Why
T-2031 (merged 2026-10-18) moved `toApiFailure`, `fromApi` and `runApiAbortable` into client-core. Its pre-review left two follow-ups outside that task's files:
1. Both apps still build their own `fromApi`.
2. The phone's GIF search still has its own abort wrapper.

### Facts (read by the lead on 2026-10-18 at `bf37aedbb`)
- **The shared helpers.** `packages/client-core/src/index.ts:1` exports `makeFromApi` and `runApiAbortable`, and `:10` exports `fromApi` and `toApiFailure`.
- **Web.** `apps/web/src/lib/effect/api-effect.ts` (8 lines) is `export const fromApi = makeFromApi(toApiFailure)`, with `toApiFailure` from `@/lib/effect/errors`. Since T-2031, that file is a re-export of client-core's `toApiFailure`.
- **Phone.** `apps/mobile/src/lib/effect/api-effect.ts` (8 lines) is the same shape.
- **GIF search.** `apps/mobile/src/lib/gifs-api.ts`:
  - `abortError()` at `:90`;
  - the abort-before, abort-during and abort-after checks at `:112-126`, the same steps `runApiAbortable` does (`packages/client-core/src/api-effect.ts`).

### Steps
1. **The `fromApi` files.** Make each app's `lib/effect/api-effect.ts` one line, `export { fromApi } from '@zilar/client-core';`, so importers don't change. Add the file's `effect-plain` marker if the Effect ratchet asks for it, as other adapters do.
2. **GIF search.** `apps/mobile/src/lib/gifs-api.ts` uses `runApiAbortable(effect, signal)` for its search call and deletes `abortError` and the hand-written checks. The thrown error on abort stays a `DOMException` named `AbortError`.
3. **Tests.** No new tests: `runApiAbortable` is tested in client-core. Existing GIF tests, if any, must pass.

### Allowed files
- `apps/web/src/lib/effect/api-effect.ts`
- `apps/mobile/src/lib/effect/api-effect.ts`
- `apps/mobile/src/lib/gifs-api.ts`
- `work/T-2047-api-effect-reexports.md`

### Checks
```bash
pnpm gate
```

### Acceptance
The gate passes, and product lines go down.

---

## Report (written by the worker when done)

### What I did
- `apps/web/src/lib/effect/api-effect.ts`: replaced the `makeFromApi(toApiFailure)` construction with `export { fromApi } from '@zilar/client-core';`. Importers are unchanged.
- `apps/mobile/src/lib/effect/api-effect.ts`: same one-line re-export.
- `apps/mobile/src/lib/gifs-api.ts`: `pageOf` now runs the mapped Effect through `runApiAbortable(effect, signal)` from `@zilar/client-core`; deleted `abortError` and the three hand-written abort checks. An abort still surfaces as a `DOMException` named `AbortError`, as `runApiAbortable` does.
- No `effect-plain` marker was needed: the gate's effect ratchet classified both one-line re-export files as `plain`.
- No new tests; the spec asked for none. There are no existing GIF tests in the mobile app (`grep` for `gifs-api`/`createGifsApi` found only app source files, no test files).

### Files changed
- `apps/web/src/lib/effect/api-effect.ts`
- `apps/mobile/src/lib/effect/api-effect.ts`
- `apps/mobile/src/lib/gifs-api.ts`
- `work/T-2047-api-effect-reexports.md`

`git diff --stat`: 4 files changed, 7 insertions(+), 41 deletions(-).

### Checks run
- `pnpm install`: done, no errors (one pre-existing peer warning in `apps/mobile` for `@types/react`).
- No single test file was run: the change has no nearby test files (no GIF tests exist).
- `pnpm gate` (from the repo root): **GATE PASS**. Summary lines:
```
gate: 4 changed file(s) against main
PASS  install (frozen)  (1.8s)
PASS  format  (0.8s)
PASS  lint  (1.6s)
PASS  typecheck  (8.6s)
PASS  effect  (2.7s)
SKIP build @zilar/server (no server, package or manifest change)
PASS  tests @zilar/mobile  (2.9s)
SKIP tests @zilar/web (no nearby test files)
scope: every changed file is inside the Allowed files
migration: every added migration continues from the base
images: every workspace package an app image needs is copied into its Dockerfile
size: every changed source file is within 400 lines
GATE PASS
```
  The mobile test run within the gate passed.

### Notes for the lead
- Behaviour is unchanged: both apps' `lib/effect/errors.ts` already re-exported client-core's `toApiFailure`, so `makeFromApi(toApiFailure)` and client-core's `fromApi` were the same function.
- Deviations from the spec: none.
- Open questions: none.


## Review (written by Claude)

Approved; the pre-review was clean.
- **What changed.** Both `lib/effect/api-effect.ts` files re-export client-core's `fromApi`, and the phone's GIF search uses `runApiAbortable`.
- **Size.** About −34 product lines.

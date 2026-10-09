---
id: T-0772
title: "WU2: web lib helpers on Effect — clipboard, handles, handleGate, blockedJids, topicsUi, background-image, stickers, sticker-images: async work as Effects (fromApi / tryPromise), storage via Effect.try or KeyValueStore.layerStorage with runSync at a sync edge; exported signatures unchanged"
status: todo
milestone: M5
branch: task/T-0772-web-lib-helpers
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0772 (WU2): the web lib helpers on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU2), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files** (`apps/web/src/lib/`), with their lines and signals from `pnpm effect:map` on 2026-10-09:
  - `clipboard.ts` (36, H1 W4), no test;
  - `handles.ts` (113, H1), no test;
  - `handleGate.ts` (47, H5 W4), tested in `handleGate.test.ts`;
  - `blockedJids.ts` (83, H1 W4), tested in `blockedJids.test.ts`;
  - `topicsUi.ts` (79, H5 W4 W6), no test; `window.localStorage` is at line 41;
  - `background-image.ts` (113, H1 W4), tested in `background-image.test.ts`;
  - `stickers.ts` (124, W4 W6), tested in `stickers.test.ts`;
  - `sticker-images.ts` (240, H1 W4), tested in `sticker-images.test.ts`.
- **Effect 4.0.2 has `effect/persistence` `KeyValueStore`**, with `layerStorage(() => Storage)` and `layerMemory` (`node_modules/effect/dist/persistence/KeyValueStore.d.ts:243,353`).
- **The web building blocks** are in `apps/web/src/lib/effect/`: `fromApi`, `ApiFailure`, `webRuntime`, `useAction` and `useQuery`.

### The conversion pattern (same for every web UI task)
- **The goal:** after this task each listed file imports Effect for its async work, and contains no `async`, `await`, `.then(`, `try`/`catch`, `setTimeout` or `setInterval` of its own. That is the rule of `docs/audit/effect-100-plan.md` §1.3 and §3.6.
- **Use the hooks from T-0762** (`apps/web/src/lib/effect/use-action.ts`, `use-query.ts`; read their header comment):
  - `useAction(fn)` for user actions (submit, delete, toggle). It returns `[state, run, controls]`, and its `ignore` mode replaces the `busy` guards;
  - `useQuery(make, deps)` for loads, with `refresh` for reloads;
  - `failureOf(state)` and `isWaiting(state)` for the UI.
- **Calling existing API functions:** use `fromApi(() => apiFn(...))` (`apps/web/src/lib/effect/api-effect.ts`). It gives typed `ApiFailure` errors, which have `code`, `status` and `message`.
- **Timers and polling:** use `Effect.sleep`, `Effect.repeat` with `Schedule.spaced` or `Schedule.fixed`, inside `useQuery` or an atom, so unmount interrupts them. Debounce with `Effect.sleep` inside `useQuery` keyed on the input.
- **User-facing text stays byte-identical**, including the error sentences, labels and disabled states. A component keeps its props and exports.
- **Tests:** the existing tests must pass unchanged. A test that fakes `fetch` or an API module keeps working, because `fromApi` calls the same functions. Do not edit an existing test unless it asserts an implementation detail that cannot survive (for example a spied `setTimeout`); if so, explain each edit in the Report.
- **Check APIs in `node_modules/effect/dist/*.d.ts`** (Effect 4.0.2), not from memory.

### What to build
1. **Keep every exported function's name, parameters and return type,** so callers do not change. Synchronous helpers stay synchronous: inside, use `Effect.try` with a typed error, a `Schema` decode instead of `JSON.parse`, and `Effect.runSync` (or `Either`/`Exit` handling) at the export, giving the same fallback values as today. Async helpers return the same Promise from an Effect (`Effect.runPromise`, or `runWeb` when they need HTTP).
2. **Storage** (`handleGate`, `topicsUi`): read and write through `Effect.try`, or `KeyValueStore`, if that stays synchronous at the edge. A missing or broken storage gives the same fallback as today.
3. **Tests:** the existing tests pass unchanged. Add a test for `clipboard`, `handles` and `topicsUi`, covering the success path and the fallback path.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.3 and §3.6, `apps/web/src/lib/effect/*`, the eight files and their callers.

### Allowed files
`apps/web/src/lib/clipboard.ts`, `apps/web/src/lib/clipboard.test.ts`, `apps/web/src/lib/handles.ts`, `apps/web/src/lib/handles.test.ts`, `apps/web/src/lib/handleGate.ts`, `apps/web/src/lib/blockedJids.ts`, `apps/web/src/lib/topicsUi.ts`, `apps/web/src/lib/topicsUi.test.ts`, `apps/web/src/lib/background-image.ts`, `apps/web/src/lib/stickers.ts`, `apps/web/src/lib/sticker-images.ts`, `work/T-0772-web-lib-helpers.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib
pnpm gate
```
Run `pnpm effect:map` and list the eight kinds in the Report.

### Acceptance
- The eight files import Effect, with no async, timers, raw storage or try/catch of their own.
- The signatures are unchanged, and the tests pass (old unchanged, plus three new).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

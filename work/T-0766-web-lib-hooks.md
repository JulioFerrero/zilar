---
id: T-0766
title: "WU1: web lib hooks on Effect — useDelayed, useMessageSearch, usePeopleSearch, useContactRequestCount, usePendingApprovalCount, useApprovalPolling, useChatFolders, useIsServerOwner, useVoiceTranscription (timers, polling and loads via useQuery / Effect.sleep / Schedule); same hook signatures"
status: todo
milestone: M5
branch: task/T-0766-web-lib-hooks
model: auto
effort: default
depends_on: [T-0762]
estimate: 0.5 day
---

# T-0766 (WU1): the web lib hooks on Effect

## Spec (written by Claude, do not edit)

### Why
This is Phase 3 of `docs/audit/effect-100-plan.md` (task WU1), accepted by Julio on 2026-10-09.

### Verified facts (do not re-derive)
- **The files** (`apps/web/src/lib/`), with their line counts and signals from `pnpm effect:map` on 2026-10-09 (H1 async, H3 timers, W4 try/catch):
  - `useDelayed.ts` (22, H3), tested in `useDelayed.test.ts`;
  - `useMessageSearch.ts` (94, H1 H3), no test;
  - `usePeopleSearch.ts` (131, H1 H3), no test;
  - `useContactRequestCount.ts` (44, H1 H3), no test;
  - `usePendingApprovalCount.ts` (51, H1), tested in `usePendingApprovalCount.test.ts`;
  - `useApprovalPolling.ts` (221, H1 H3), tested in `useApprovalPolling.test.ts`;
  - `useChatFolders.ts` (29, H1 W4), no test;
  - `useIsServerOwner.ts` (57, H1 W4), tested in `useIsServerOwner.test.tsx`;
  - `useVoiceTranscription.ts` (52, H1 W4), tested in `useVoiceTranscription.test.tsx`.
- **`useMessageSearch.ts:66`** checks `error instanceof DOMException && error.name === 'AbortError'`; with Effect, interruption replaces the abort check.
- **The hooks** are in `apps/web/src/lib/effect/` (T-0759, T-0762).

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
1. **Convert the nine hooks.** Keep each hook's exported name, parameters and return shape, so callers do not change. Internally, use `useQuery`, `useAction` or a small atom on `webAtomRuntime`.
2. **Debounces and polls** (`useMessageSearch`, `usePeopleSearch`, `useApprovalPolling`, `useContactRequestCount`) become Effects that are interrupted on an input change or an unmount. Keep the same intervals and delays (read the constants).
3. **Tests:** add a small test for each hook that has none (four hooks), checking the debounce or poll behaviour with vitest fake timers or real short waits. The existing tests pass unchanged.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-100-plan.md` §3.3 and §3.6, `apps/web/src/lib/effect/*`, the nine hooks and their callers (`git grep -l "<hookName>" apps/web/src`).

### Allowed files
`apps/web/src/lib/useDelayed.ts`, `apps/web/src/lib/useMessageSearch.ts`, `apps/web/src/lib/useMessageSearch.test.ts`, `apps/web/src/lib/usePeopleSearch.ts`, `apps/web/src/lib/usePeopleSearch.test.ts`, `apps/web/src/lib/useContactRequestCount.ts`, `apps/web/src/lib/useContactRequestCount.test.ts`, `apps/web/src/lib/usePendingApprovalCount.ts`, `apps/web/src/lib/useApprovalPolling.ts`, `apps/web/src/lib/useChatFolders.ts`, `apps/web/src/lib/useChatFolders.test.ts`, `apps/web/src/lib/useIsServerOwner.ts`, `apps/web/src/lib/useVoiceTranscription.ts`, `work/T-0766-web-lib-hooks.md`.

### Checks
```bash
pnpm --filter @zilar/web test --reporter=dot src/lib
pnpm gate
```
Run `pnpm effect:map` and list in the Report the kind of each of the nine files.

### Acceptance
- The nine files import Effect and have no async, timers or try/catch of their own.
- The hook signatures are unchanged, and the tests pass (old unchanged, plus four new).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

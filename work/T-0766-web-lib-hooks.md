---
id: T-0766
title: "WU1: web lib hooks on Effect — useDelayed, useMessageSearch, usePeopleSearch, useContactRequestCount, usePendingApprovalCount, useApprovalPolling, useChatFolders, useIsServerOwner, useVoiceTranscription (timers, polling and loads via useQuery / Effect.sleep / Schedule); same hook signatures"
status: merged
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

All nine hooks now run their async work as Effects, with the same exported names, parameters and return shapes. Four new test files cover the four hooks that had none.

**Files changed (inside Allowed):** the nine hooks under `apps/web/src/lib/`; new tests `useMessageSearch.test.ts`, `usePeopleSearch.test.ts`, `useContactRequestCount.test.ts`, `useChatFolders.test.ts`; this task file. No existing test was edited.

**How each one runs (no `async`, `await`, `.then`, `try`, timers of its own):**
- `useDelayed`: `useQuery` on `Effect.sleep(delayMs)`; a changed value interrupts the old sleep.
- `usePendingApprovalCount`, `useChatFolders`, `useContactRequestCount`, `useApprovalPolling`, `useMessageSearch`, `usePeopleSearch`: `useAction` as the runner. The Effect calls `fromApi(...)` and writes state with `Effect.sync(setState)`. Polls use `Effect.repeat(..., Schedule.fixed(...))`. Debounces use `Effect.sleep`. Unmount or a dependency change interrupts them. Visibility and focus reads are separate runs, so they never restart the loop.
- `useIsServerOwner`, `useVoiceTranscriptionEnabled`: `useQuery` once per mount, or an immediate success when the module cache is set. The cache is written inside the Effect.

**Test counts (`pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot <files>`):**
- Hook tests, before: 20 passed (5 files). After: 39 passed (9 files): the 20 old ones unchanged, plus 19 new.
- Caller tests (ChatList, Skeleton, AiActivity, ApprovalCard, MessageSearch, PeopleSearchResult, VoiceMessage, ChatShell, FoldersPage, InstallMenu, TelegramImportDialog, StickersPage), before: 147 passed (12 files). After: 147 passed (12 files).

**`pnpm effect:map`** (838 files, run on this tree): all nine are `kind: effect`, with no H1, H3 or W4 signals.

**`pnpm gate`** from the worktree root: exit 0, `GATE PASS`. Summary lines: `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/web`, `scope: every changed file is inside the Allowed files`. The gate reported 14 changed files, all inside Allowed.

**Deviations from the spec, and why:**
1. `useApprovalPolling`: `TimerSource` and the `timers` option stay exported and typed. The unchanged test imports the type and passes `timers`, and that test file is not in Allowed. The option is now ignored, and the `window.setInterval` default is gone. The type declaration still names `setInterval`/`setTimeout` as property names.
2. `useIsServerOwner` and `useVoiceTranscriptionEnabled`: unmounting before the answer arrives interrupts the request, so the module cache is not filled. The next mount asks again. The old code cached the answer anyway.
3. `useMessageSearch`: unchanged in behaviour. A query change waits 250 ms, a chat-only change searches at once, and `unavailable` stays until the server says otherwise. The superseded request is aborted by interruption, which replaces the `AbortError` check.
4. `usePeopleSearch`: the debounce and the lookup are two runners. A lookup still in flight keeps its result while the next debounce waits, as before.
5. `usePendingApprovalCount` and `useContactRequestCount` keep their last count when `enabled` goes false, as before. `useQuery` would have reset it, which is why they use `useAction` plus `useState`.

**Unsure:** whether using `useAction` as a runner (with `Effect.sync(setState)`) for loops and debounces is the intended use, or whether a later pass should move these to a shared atom. Behaviour is covered by the tests above, but no real-chat check was done.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5. The lead reviewed the code directly.
- **The hooks:** all nine are Effect files. Debounces and searches use `useAction` in `replace` mode, so a new input interrupts the old run and aborts its request. Polls are `Effect.repeat` on `Schedule.fixed`, interrupted on unmount.
- **The intervals and delays** are unchanged.
- **The `TimerSource` type is still exported** (ignored) for the unchanged test.
- **Tests:** the hooks go from 20 to 39, the callers stay at 147, and the gate passed.

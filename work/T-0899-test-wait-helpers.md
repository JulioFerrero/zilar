---
id: T-0899
title: "One flush/waitFor/jsonResponse per package, real sleeps replaced with fake timers, and a guard against one-tick waits (simplify plan 5.5, F-F8)"
status: todo
milestone: M5
branch: task/T-0899-test-wait-helpers
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-0899: One flush/waitFor/jsonResponse per package, real sleeps replaced with fake timers, and a guard against one-tick waits (simplify plan 5.5, F-F8)

## Spec (written by Claude, do not edit)

### Why
The audit (`docs/audit/simplify-2026-10-09/F-tests.md`, section F8) counted about 24 copies of `async function flush()`, 15 of `settle()`, 13 or more of `waitFor` and about 80 of `jsonResponse`, with different meanings: some wait five microtask ticks, some two `setTimeout(r, 0)` ticks, some poll. Tests that rely on "one tick is enough" made CI red on 2026-10-09; T-0842 and T-0888 fixed two of them. Fixed real sleeps also cost about 15 s of web test time.

### What to build, one commit per package
1. **One helper module per package:** `apps/web/src/test/wait.ts` (`apps/web/src/test/` exists: `renderApp.tsx`, `setup.ts`, `storeHarness.ts`), `apps/mobile/src/test/wait.ts`, and `apps/server/src/test-support/wait.ts` (check what exists first). Each exports:
   - `flushMicrotasks()`;
   - `waitFor(check, { timeout })`, which polls with fake-timer support;
   - `jsonResponse(body, init)`, which returns a real `Response`, and a 204 gets a null body.
2. **Replace the local copies** in that package's tests with imports. Do not change what a test asserts.
   - Where a test waited "one tick" for a visible state, wait for the state instead (`findBy*` or `waitFor`), as T-0842 did.
   - Leave alone tests whose flush semantics are load-bearing in a way you cannot prove; list them in the Report.
3. **Real sleeps:** replace the fixed real sleeps the audit lists with fake timers (`vi.useFakeTimers` and `vi.advanceTimersByTimeAsync`; `apps/web/src/store/effects/runtime.test.ts` is the model):
   - `realStore.topics.test.tsx`: ten waits of 600 ms;
   - `realStore.test.tsx`;
   - `ChatList.test.tsx`: the connecting bars;
   - `TypingIndicator.test.tsx`.

   Find the current lines with grep. Report the web suite wall time before and after (one run each).
4. **Guard:** add a test, or an oxlint rule if it supports one, that fails on `setTimeout(resolve, 0)` or `setTimeout(r, 0)` inside test files outside the helper modules.

**Do not edit** these mobile files, which T-0898 rewrites in parallel: `composer-layout`, `search-jump`, `attach-sheet`, `attachment-video`, `group-roles-mounted`, `composer-gifs`, `attachment-message`, `gif-panel` and `hooks-guard`.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; scratch files only in `<scratchpad>/<task id>/`) and `docs/audit/simplify-2026-10-09/F-tests.md` (F8).

### Allowed files
`apps/web/src/test/**`, `apps/web/src/**/*.test.ts`, `apps/web/src/**/*.test.tsx`, `apps/mobile/src/test/**`, `apps/mobile/src/**/*.test.ts`, `apps/mobile/src/**/*.test.tsx`, `apps/server/src/test-support/**`, `apps/server/src/**/*.test.ts`, `work/T-0899-test-wait-helpers.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/web exec vitest run --reporter=dot
pnpm --filter @zilar/mobile exec vitest run --reporter=dot
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=120000 --hookTimeout=120000 <the server test files you changed>
pnpm --filter @zilar/web typecheck
pnpm --filter @zilar/mobile typecheck
pnpm --filter @zilar/server typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```
Run the web and mobile suites 3 times at the end, because flakiness is the target.

### Acceptance
- The Checks pass 3 times in a row.
- The guard exists, and the Report gives the copy counts and web wall time before and after.
- No production code changes.

---

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-0036
title: Make the apps/web test suite reliable under machine load (package-level fix)
status: todo
milestone: M2
branch: task/T-0036-web-tests-under-load
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0029]
estimate: 1 day
---

# T-0036: apps/web tests that don't fail just because the machine is busy

## Spec (written by Claude, do not edit)

### Goal

T-0029 fixed three load-sensitive web tests with per-test timeouts. Under heavier load (load average 96, during a parallel Xcode build), three **other** tests timed out:
- `ChatList.test.tsx > filters chats by folder`
- `Composer.test.tsx > shows the mic when empty…`
- `NewChatButton.test.tsx > creates a group from the dialog…`

In each case it's the **first full-app render in the file** (`renderApp`), which pays the cold import and render cost. Per-test timeouts don't scale, since every new first test is another trap. The lead reviews every task by re-running the suite, often while other workers are running. A red run that isn't real wastes a review round, or worse, teaches everyone to ignore red.

Find the **cause** and fix it once, at the package level.

### Read first
- `AGENTS.md` (mandatory)
- `work/T-0029-flaky-web-tests.md`: what was measured, the CPU-burner method, and the per-test timeouts it added.
- `apps/web/vite.config.ts` (the `test` section), `apps/web/src/test/setup.ts` and `apps/web/src/test/renderApp.tsx`
- The three test files above, and the three T-0029 touched.

### Allowed files
- `apps/web/vite.config.ts`: the `test` section only.
- `apps/web/src/test/**`
- `apps/web/src/**/*.test.tsx` and `apps/web/src/**/*.test.ts`: only to adopt the package-level fix, for example removing T-0029's per-test timeouts if they're no longer needed, or using a shared helper. Don't change what a test asserts.
- `work/T-0036-web-tests-under-load.md`

**Not allowed:**
- non-test source under `apps/web/src/` (components, routes, store, lib). Another task (T-0033) is changing `lib/api.ts` and `store/realStore.ts` right now.
- `apps/server/**`
- `apps/mobile/**`
- `packages/**`
- root configs
- `docs/**`

### Allowed dependencies
None.

### What to do

1. **Measure first.** Find where the time goes in a first full-app render: module import and transform, jsdom setup, the render itself, or `findBy*` waits.
   - Use `vitest --reporter=verbose` and timings, or `performance.now()` probes you remove afterwards.
   - Put the numbers in the Report.
2. **Fix it at the package level.** Pick whichever the measurements support, and **justify it with numbers**:
   - a single, commented `testTimeout` and/or `hookTimeout` for `apps/web`, sized from measured worst cases under load, not guessed;
   - warming the heavy imports once in `setup.ts`;
   - a lighter `renderApp`;
   - vitest pool or isolation settings that cut repeated cold imports;
   - a combination of these.
3. Once the package-level fix covers T-0029's per-test timeouts, remove them, so there's one mechanism, not two.
4. **Don't** hide real failures:
   - no retries;
   - nothing that makes `findBy*` wait forever;
   - timeouts only as high as the measurements justify.

### Proof (report real numbers)
Use T-0029's method, a CPU burner (`yes > /dev/null` per core you want to load) killed afterwards, to compare before and after:
- `apps/web` alone, idle: 3 runs;
- `apps/web` alone, with the burner: 3 runs;
- `pnpm exec turbo test --force` (the full monorepo), with the burner: 3 runs.

Before the fix, show at least one failure or the timing margin that proves the risk. After, every run must pass. **Kill every burner process you start, and show that none is left running** (`pgrep -x yes` prints nothing).

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] 3 of 3 full forced monorepo runs pass with a CPU burner running, and the numbers are in the Report.
- [ ] One package-level mechanism, commented with the measured reason. No leftover per-test timeouts it makes redundant.
- [ ] No test assertion was weakened, and no retries were added.
- [ ] No burner process is left running.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- Server, mobile or package tests.
- Making the app itself faster.

## Report (written by the worker when done)

## Review (written by Claude)

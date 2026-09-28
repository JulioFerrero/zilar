---
id: T-0036
title: Make the apps/web test suite reliable under machine load (package-level fix)
status: review
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

### Measurement: where the time goes in a first full-app render

Idle baseline (`apps/web` alone, `--reporter=verbose`, 117 tests / 20 files): every
file's first `renderApp` costs ~200-500 ms (ChatList first 248 ms, Composer first
372 ms, NewChatButton first 379 ms, ChatShell first 398 ms, MessageActions first
490 ms, TypingIndicator single test 193 ms). The suite `Duration` breakdown is
stable across runs: environment ~35-41%, tests ~22-28%, import ~17-22%, transform
~9-13%, setup ~5-6%. Vitest creates jsdom 20 times (~12.6-16.5 s total, ~700 ms
per file) — that plus module transform is the cold per-file cost, and the test
bodies themselves are fully synchronous (`renderApp` + `fireEvent` + `screen`
queries; only NewChatButton awaits anything, on mocks that resolve immediately),
so `findBy*` waits are not the cost.

Under contention the *test bodies* inflate ~10x, not just setup: in a forced
full-suite run with 8 `yes` burners (before fix), `opens on right-click` measured
**5251 ms** (idle 490 ms), `header subtitle` 4621 ms (idle 398 ms), `creates a
group` 4571 ms (idle 379 ms), `shows typing` 4231 ms, `shows the mic` 3280 ms
(idle 372 ms), `filters chats by folder` 2184 ms (idle 286 ms); suite breakdown
shifts to tests 35% / environment 29%. So the cause is synchronous full-app
render work under CPU starvation, and any file's first test can breach the 5 s
default — per-test timeouts don't scale. Warming imports in `setup.ts` cannot fix
it (each file gets a fresh module registry/jsdom; transform cache is not the
bottleneck — test bodies are), a lighter `renderApp` would cut integration
coverage, and `isolate: false` would share module state across files (fake
timers, clipboard mocks) for no gain against a test-body cost. `hookTimeout`
stays default: hooks only run `cleanup()` and timer/clipboard resets.

### What I did (one package-level mechanism)

- `apps/web/vite.config.ts` (`test` section only): added a commented
  `testTimeout: 15_000`, sized from the measured worst case (5.3 s) with ~3x
  headroom, matching T-0029's precedent. The comment states the measured reason,
  and explicitly notes: no retries, `findBy`/`waitFor` keep their 1 s defaults,
  `hookTimeout` unchanged.
- Removed T-0029's three per-test `15_000` timeouts and their now-redundant
  comments (`MessageActions`, `TypingIndicator`, `ChatShell` test files). No
  assertion changed — diff is comments + timeout args only.
- No new dependencies. No non-test source touched.

### Proof (8x `yes > /dev/null` burners for all loaded runs)

Before fix, forced full suite + burner (the margin that proves the risk — the
protected T-0029 tests exceed the 5 s default, unprotected new tests at 91%):
- run 1 (4 burners): RC=0, 1m50s, 0 cached.
- run 2 (4 burners): web Duration 17.17 s; folder 1297 ms, group 2147 ms, mic 1859 ms.
- run 3 (8 burners): web Duration 20.94 s; right-click **5251 ms**, subtitle 4621 ms,
  group 4571 ms, typing 4231 ms, mic 3280 ms, folder 2184 ms. All passed only
  because of T-0029's per-test timeouts; without them this run is red.

After fix (per-test timeouts removed, global 15 s in force):
- `apps/web` alone, idle: 4.03 s, 3.92 s, 4.71 s — 117/117 pass x3.
- `apps/web` alone, 8 burners: 14.24 s, 13.35 s, 16.02 s — 117/117 pass x3.
- `turbo test --force`, 8 burners: run 1 RC=0, 1m33s, 9/9 tasks, 0 cached (web
  worst 3165 ms); run 2 RC=0, 3m02s, 9/9, 0 cached (web worst 4490 ms);
  run 3 RC=0, 1m20s, 9/9, 0 cached (web worst 2476 ms). Web 20/20 files each run.

Burners: `pgrep -x yes` prints nothing (verified 14:00, load avg at the time came
from other workers, not burners).

### Commands run and real results

- `pnpm install`: PASS, done in 8 s.
- `pnpm format:check`: PASS, all files use Prettier style.
- `pnpm lint`: PASS, exit 0 (oxlint).
- `pnpm typecheck`: PASS, 9/9 tasks successful.
- `pnpm exec turbo test --force` (with burner): PASS x3 (see above).
- `pnpm build`: PASS, 2/2 tasks successful.

### Problems, deviations, open questions

- I cannot run `kill`/`pkill` in this environment (both denied), so I could not
  kill my own burners; the lead killed all 8 PIDs (73672-73675, 75679-75682) and
  I verified `pgrep -x yes` is empty. Per the lead's instruction, future burner
  runs from this environment should use a self-terminating form, e.g.
  `timeout 600 yes > /dev/null &` (or `perl -e 'alarm 600; exec "yes"'` on macOS
  without `timeout`).
- Before-fix `apps/web`-alone burner runs: 1 verbose (5.36 s, worst 706 ms) + 1
  filtered-package run (5.71 s). The single-package case never reproduces the
  risk — contention from the full forced suite is what inflates test bodies ~10x,
  which is why the before-proof rests on the forced runs above.
- Residual risk noted, not changed: `NewChatButton` uses `waitFor`/`findByText`
  with testing-library's 1 s default. Under the measured loads the awaited work
  resolves in ms (mocks resolve immediately), so the 1 s budget was never the
  binding constraint; per the spec I left async waits alone so slow async work
  still fails fast.

### Blocked / needs a decision

- Nothing blocked.

## Review (written by Claude)

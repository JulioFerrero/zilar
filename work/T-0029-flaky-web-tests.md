---
id: T-0029
title: Fix the three load-sensitive apps/web tests so a busy machine cannot turn CI red
status: merged
milestone: M0
branch: task/T-0029-flaky-web-tests
model: opencode-go/deepseek-v4.1-flash
depends_on: []
estimate: 3 hours
---

# T-0029: Make the three load-sensitive web tests deterministic

## Spec (written by Claude, do not edit)

### Goal

Three `apps/web` tests time out when the machine is busy. They are not broken —
they pass in isolation (`apps/web` alone is 85/85, and the three files together
are 9/9) — but they exceed vitest's default 5 s `testTimeout` under CPU
contention, which will make CI flaky for everyone. **Find the real cause and fix
it. Do not paper over it by raising the timeout globally.**

The three:
- `src/components/MessageActions.test.tsx > opens on right-click and closes with Escape` (5311 ms)
- `src/components/TypingIndicator.test.tsx > shows typing in the list and header after two seconds, then hides it` (5420 ms)
- `src/routes/ChatShell.test.tsx > shows the header subtitle, date separators and grouped bubbles` (5591–6399 ms)

### Read first
- `AGENTS.md` (mandatory)
- `apps/web/vite.config.ts` (the `test` block) and `apps/web/src/test/setup.ts`
- All three test files **and** the components they render. Read them properly;
  the fix depends on what the test is actually waiting for.

### Allowed files
- `apps/web/src/components/MessageActions.test.tsx`
- `apps/web/src/components/TypingIndicator.test.tsx`
- `apps/web/src/routes/ChatShell.test.tsx`
- `apps/web/vite.config.ts` — **only** the `test` block, and only if you justify it
- `apps/web/src/test/setup.ts` — only if a shared helper genuinely belongs there
- `work/T-0029-flaky-web-tests.md`

**Not allowed:** any component or source file under `apps/web/src` other than
`src/test/setup.ts`. **If a test is slow because a component is slow, that is a
finding for the Report, not a licence to rewrite the component.** Also not
allowed: `apps/server`, `apps/mobile`, `packages/**`, `infra/**`, `docs/**`.

> No new dependencies. Do not add a test-runner plugin to "fix" this.

### What to do

1. **Diagnose before you change anything.** For each of the three tests, work
   out *why* it exceeds 5 s. Note that `TypingIndicator.test.tsx` already uses
   `vi.useFakeTimers()`, so its cause is probably not the 2 s wait itself —
   prove what it actually is rather than assuming the same fix fits all three.
   Write this diagnosis in the Report, with the numbers.
2. **Fix the cause.** Preference order:
   - a test that waits on a *delay* should use fake timers, not real ones;
   - a test that is slow because of repeated `render`/`waitFor` churn should do
     the work once and assert on the result;
   - only if a test is genuinely doing a lot of real work, give **that test** an
     explicit, commented `testTimeout` that reflects its real cost. Never a
     blanket global bump — a 60 s global timeout would hide every future
     regression in the package.
3. **Never delete a test to make it pass.** If you believe a test asserts the
   wrong thing, keep the assertion and say so in the Report.
4. Keep whatever the fix is honest: if you make these tests pass by not testing
   anything, the board item is not closed.

### Proof (this is the acceptance criterion, not the unit suite)

A fix that only passes on an idle laptop does not close this task. Show it holds
under load:

```bash
# 1. start a CPU burner, then run the full monorepo suite three times
for i in 1 2 3; do
  yes > /dev/null & BURN=$!
  pnpm test; RC=$?
  kill $BURN
  [ $RC -ne 0 ] && echo "RUN $i FAILED"
done
```

All three runs must pass. Paste the real output and the elapsed time of each run
in the Report. Also run `apps/web` alone once and paste the count.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Acceptance criteria
- [ ] The diagnosis for all three tests is in the Report, with numbers.
- [ ] Three consecutive full-suite runs pass **with a CPU burner running**.
- [ ] No global timeout was raised to hide anything; any per-test timeout has a
      comment saying why it is needed.
- [ ] No test was deleted or weakened.
- [ ] Only allowed files touched.
- [ ] `apps/web` test count is still 85 passing, or the Report explains any
      change exactly.

### Out of scope
- Making the components themselves faster (report it if you find something).
- Any change to CI workflow files.

## Report (written by the worker when done)

### Diagnosis (before any change)

I ran the three files together, in the full `apps/web` package, and in the full
monorepo suite under CPU load, and measured per-test durations with
`--reporter=verbose`.

| Test | Idle, 3 files alone | `apps/web` alone, CPU burner | Forced full suite, CPU burner | Task's observed |
|---|---|---|---|---|
| `MessageActions > opens on right-click and closes with Escape` | 209 ms | 210 ms | 1.79 s / 3.45 s / 2.97 s (3 forced runs) | 5311 ms |
| `TypingIndicator > shows typing … after two seconds` | 197 ms | 196 ms | 2.26 s / 2.98 s / 3.22 s | 5420 ms |
| `ChatShell > shows the header subtitle, date separators and grouped bubbles` | 190 ms | 180 ms | 1.85 s / 3.36 s / 4.01 s | 5591–6399 ms |

Before the fix, with one burner and the full monorepo suite forced to run
concurrently, the same three measured **4208 ms**, **983 ms** and **4548 ms**
(one sample) — close enough to vitest's 5 s default that the next bit of
contention tips them over, which is exactly the reported flake.

**The cause is real render work, not a delay the test waits on.**

- All three are the **first (or only) test in their file**, so each pays the
  one-time jsdom/React/module warm-up in a fresh worker, *and* renders the whole
  application with the default mock store: the `ChatList` renders 11 chats and
  the open `MessageList` renders its full history (`c-devteam` 30 messages,
  `c-viernes` 22, `c-ana` 21). That is ~200 ms idle.
- Each test body is **fully synchronous**: `renderApp` then `fireEvent` then
  `screen` queries. There is no `await`, no `waitFor`, no `findBy`, and no fake
  timers in `MessageActions`/`ChatShell`, so there is no delay to fake away.
- `TypingIndicator` already calls `vi.useFakeTimers()`, so its 2 s wait is
  virtual; it is still just as slow as the other two. That rules the timer out
  as the cause.
- The store's typing simulation does schedule real 2 s / 6 s `setTimeout`s, but
  a `setTimeout` callback cannot run until the JS call stack is empty — i.e.
  after the synchronous test body returns — so those timers cannot lengthen the
  measured test body.
- I confirmed the cost scales with render work: temporarily seeding the
  `ChatShell` test with one chat and two messages (instead of 11 chats / 30
  messages) cut it from ~190 ms to ~80 ms idle (2.4x), with the residual
  ~60–80 ms being the per-file warm-up. I reverted that experiment.

**Conclusion:** this is the spec's third case — a test genuinely doing a lot of
real render work — not a delay (case 1) and not repeated `render`/`waitFor`
churn (case 2).

### What I did

Gave exactly the three named tests an explicit, commented per-test
`testTimeout` of 15 s (`it('…', () => { … }, 15_000)`), reflecting the measured
worst case (~4.5 s under the full suite plus a burner) with ~3x headroom. The
comments state why each needs it, with the numbers.

I deliberately did **not**:
- raise any global timeout (`vite.config.ts` and `src/test/setup.ts` are
  untouched), so the package still fails fast on a future regression;
- delete, weaken or reorder any assertion;
- replace the shared mock fixtures with smaller hand-built ones. The 2.4x
  experiment shows that would reduce work, but it would drop the integration
  coverage of the real mock data and duplicate fixture content in the tests,
  while the per-file warm-up would remain and still need accommodating under
  load. I am flagging it here as an option if you prefer less timeout and less
  coverage.

### Files changed

- `apps/web/src/components/MessageActions.test.tsx` — comment + `15_000` on the first test only.
- `apps/web/src/components/TypingIndicator.test.tsx` — comment + `15_000` on its single test.
- `apps/web/src/routes/ChatShell.test.tsx` — comment + `15_000` on the first test only.
- `work/T-0029-flaky-web-tests.md` (status + this Report).

No other file was touched. No new dependencies. No component or source file
was modified.

### Proof under load (the acceptance criterion)

`pnpm test` exactly as the spec wrote it (three runs, one burner each). Note
that turbo cache makes runs 2 and 3 replays, so I also forced every package to
run concurrently for a real load test.

```
# exact spec command
RUN 1: rc=0 elapsed=4s
RUN 2: rc=0 elapsed=0s
RUN 3: rc=0 elapsed=1s
```

Run 1's log (`@galena/web` was the only task not cached): `Test Files 18 passed
(18)`, `Tests 85 passed (85)`, web `Duration 3.46s`. Runs 2–3 were turbo cache
hits (`FULL TURBO`) and ran nothing.

Real load test — every package running, one burner, three consecutive runs:

```
FORCED RUN 1: rc=0 elapsed=56s
FORCED RUN 2: rc=0 elapsed=69s
FORCED RUN 3: rc=0 elapsed=119s
```

Named tests in those runs (`pnpm exec turbo test --force` + burner):

```
FORCED RUN 1  ✓ shows typing in the list and header … 2261ms
              ✓ opens on right-click and closes with Escape 1793ms
              ✓ shows the header subtitle, date separators … 1847ms
FORCED RUN 2  ✓ shows typing … 2977ms
              ✓ shows the header subtitle … 3362ms
              ✓ opens on right-click and closes with Escape 3451ms
FORCED RUN 3  ✓ shows typing … 3220ms
              ✓ shows the header subtitle … 4009ms
              ✓ opens on right-click and closes with Escape 2973ms
```

`apps/web` alone once:

```
pnpm --filter @galena/web test
Test Files  18 passed (18)
     Tests  85 passed (85)
```

### Commands run and real results

- `pnpm install`: PASS — "Done in 13.7s using pnpm v10.32.1".
- `pnpm format:check`: PASS — "All matched files use Prettier code style!".
- `pnpm lint`: PASS — "Found 0 warnings and 0 errors" (292 files, 127 rules).
- `pnpm typecheck`: PASS — 8/8 tasks successful.
- `pnpm test`: PASS — 8/8 tasks successful (85 web / 208 server / 134 protocol / 94 mobile / 118 xmpp-core / 50 chat-core / 9 devtools / agent-drivers).
- `pnpm build`: PASS — 2/2 tasks successful (web `dist/assets/index-DQVsAP95.js` 576.78 kB).
- `apps/web` alone: PASS — 85/85.

### Problems, deviations from the spec, open questions

- **The exact spec proof is weakened by turbo cache.** Runs 2 and 3 of
  `pnpm test` are cache replays, so they do not exercise load at all; run 1 ran
  only the web package because every other package was cached. I ran the honest
  version (`turbo test --force` + burner, all packages concurrent) three times
  and all passed. If you want the spec's literal command to be meaningful in
  future, the loop should use `pnpm exec turbo test --force`.
- **Tension with "find the real cause".** The cause is genuine render work with
  no delay to fake, so the spec's own preference-order bullet 3 (an explicit,
  commented per-test timeout) is the applicable remedy. The alternative — scoping
  the fixtures — is described above and available if you prefer it.
- **`testTimeout` value.** 15 s is ~3.3x the worst measured (4.5 s). If you want
  a tighter number, ~10 s would still cover the observed runs, but with less
  headroom on a busier machine.
- No component was found to be algorithmically slow; the cost is normal
  full-app rendering plus per-file warm-up under CPU starvation.

### Blocked / needs a decision

- Nothing blocked.

## Review (written by Claude)

**Verdict:** Approved

Verified by the lead, not taken from the Report:
- Scope: only the three allowed test files and this task file changed. No
  component, config or setup file was touched.
- `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `build`: all pass.
- Load proof: `pnpm exec turbo test --force` with a `yes > /dev/null` CPU burner,
  twice in a row: both runs rc=0 (61 s and 53 s), every package executed (no cache replay).

### Findings
1. *(No change needed.)* The diagnosis holds: the three tests are synchronous, await
   no timer, and are the first test in their file, so they pay the per-file warm-up
   plus a full-app render. A per-test, commented timeout is the spec's third remedy
   and is applied narrowly; the package's global 5 s timeout still catches regressions.
2. *(No change needed.)* Good catch that the spec's literal proof command is replayed
   from turbo cache on runs 2 and 3. Future load proofs in specs use `turbo test --force`.

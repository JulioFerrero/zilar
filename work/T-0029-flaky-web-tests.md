---
id: T-0029
title: Fix the three load-sensitive apps/web tests so a busy machine cannot turn CI red
status: ready
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

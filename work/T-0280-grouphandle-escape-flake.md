---
id: T-0280
title: "Web tests: the GroupHandleRoute Escape tests stop flaking under load"
status: merged
milestone: M5
branch: task/T-0280-grouphandle-escape-flake
model: auto
effort: low
depends_on: []
estimate: 0.2 day
---

# T-0280: GroupHandleRoute Escape flake

## Spec (written by Claude, do not edit)

### Why
`apps/web/src/routes/GroupHandleRoute.test.tsx` "closes the error card with Escape" (lines 157-166) failed once in each of the T-0273 and T-0277 gates. The error card was still in the DOM after Escape. Both times it passed on a re-run. A flake like this can turn CI red on main, and CI red blocks the auto-deploy (T-0260).

### Verified facts (do not re-derive)
- The test:
  1. renders the route with `lookupMock` rejecting;
  2. waits with `findByRole('dialog', { name: 'Open @hiking_club' })`;
  3. fires `fireEvent.keyDown(document, { key: 'Escape' })`;
  4. asserts synchronously with `queryByRole(...)).toBeNull()`.
  "closes the group card with Escape" (lines 147-155) has the same shape.
- `apps/web/src/routes/GroupHandleRoute.tsx`:
  - while `lookup.state` is `'checking'` the route renders `AddContactDialog` (line 105). The lookup runs in a `setTimeout(…, 0)` (lines 74-78) and then swaps to the error `Dialog` (line 107);
  - `close` (line 88) sets `open` to false and navigates to `/`.
- `apps/web/src/components/ui/dialog.tsx`:
  - Escape is a `document` keydown listener added in a `useEffect` (lines 66-82);
  - it only closes when this panel is the last `[role="dialog"]` in the document (lines 74-77).

### What to do
1. **Find the real cause.** Run the file in a loop under load, for example 30 runs with `--maxWorkers=2` while another `pnpm --filter @zilar/web test` runs. Likely candidates:
   - the Escape fires before the error Dialog's keydown effect is attached;
   - the outgoing `AddContactDialog` is still the last `[role="dialog"]`.
   Say which one it is in the Report, with evidence.
2. **Fix the tests** so they wait for the right state, for example `await waitFor(...)` around the null assertion, or by waiting for the dialog to be ready before firing Escape.
   - Do the same in the group-card Escape test.
   - If the cause is a real product bug (Escape lost in the first moment after the card swaps), fix it in the route or the kit `Dialog`, and add a test that fails without the fix.
3. **Prove it:** 30 loop runs under load with no failure. Quote the command and the count in the Report.

### Read first
`AGENTS.md`, `apps/web/src/routes/GroupHandleRoute.tsx`, its test, and `apps/web/src/components/ui/dialog.tsx`.

### Allowed files
`apps/web/src/routes/GroupHandleRoute.test.tsx`, `apps/web/src/routes/GroupHandleRoute.tsx`, `apps/web/src/components/ui/dialog.tsx`, `apps/web/src/components/ui/kit.test.tsx`, `work/T-0280-grouphandle-escape-flake.md`.

### Checks
```bash
pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupHandleRoute kit
pnpm gate
```

### Acceptance
- The Report names the cause with evidence and shows 30 loop runs with 0 failures.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### Cause (with evidence)

The Escape keypress is lost because the test fires it in the window between the
new panel's commit to the DOM and React flushing the passive `useEffect` that
attaches its document keydown listener (`apps/web/src/components/ui/dialog.tsx`
lines 66-82). It is **not** the outgoing `AddContactDialog` still being the last
`[role="dialog"]`: at the moment of the loss there is exactly one dialog in the
DOM.

Evidence. A temporary probe (since reverted) replicated the group-card test and
logged readiness immediately before Escape:

```
PROBE_ESC {"before":{"activeIsJoin":false,"activeTag":"BODY","dialogs":1,"panels":1},"after":1}
```

That was run 47/60 under load: `activeIsJoin: false` means the Dialog's focus
effect had not run yet (the focus effect and the Escape-listener effect are
flushed together), while `dialogs: 1` shows the `Add contact` dialog was already
gone. Baseline without the fix: running the two Escape tests 60 times with
`--maxWorkers=2` under CPU load gave **6/60 failures**, at
`GroupHandleRoute.test.tsx:154` (group card) and `:182` (error card); the DOM
dump showed the card still present after Escape.

The timing comes from RTL itself: `findBy*`/`waitFor` use `asyncWrapper`, which
deliberately runs with `IS_REACT_ACT_ENVIRONMENT = false` and drains the
microtask queue, so it can resolve after the panel is committed but before
React's passive effects run. In a browser there is no such observer; the effect
attaches in the task right after the commit, so this is a test-harness race, not
a user-facing product bug. I took the spec's primary path ("fix the tests so
they wait for the right state") and left product code alone.

### Changes

- `apps/web/src/routes/GroupHandleRoute.test.tsx`: in both Escape tests, find the
  panel's first focusable button and wait for it to receive focus
  (`await waitFor(() => expect(document.activeElement).toBe(button))`) before
  pressing Escape. The Dialog focuses and attaches the Escape listener in the
  same effect flush, so once focus has landed the listener is attached. No
  product code changed.

Files changed: `apps/web/src/routes/GroupHandleRoute.test.tsx`,
`work/T-0280-grouphandle-escape-flake.md`.

### Commands and results

- Single file: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupHandleRoute` → 9 passed.
- Checks: `pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupHandleRoute kit` → passed (also run in the loop below).
- Proof, 30 loop runs under load (6 `yes` CPU burners), same command:
  `for i in $(seq 1 30); do pnpm --filter @zilar/web test --maxWorkers=2 --reporter=dot GroupHandleRoute kit; done`
  → **PROOF FAILURES=0 / 30**.
- `pnpm gate` from the repo root:

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (0.9s)
PASS  format  (11.5s)
PASS  lint  (0.8s)
PASS  typecheck  (6.7s)
PASS  tests @zilar/web  (2.3s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Deviations / open questions

- `dialog.tsx` and `GroupHandleRoute.tsx` were left unchanged; the fix is
  test-only, per the reasoning above.
- No test was added to `kit.test.tsx`. A deterministic test for a product
  change would have to observe the commit-before-passive-effects window, which
  is the same RTL race; I tried a `flushSync`-based variant and it does not
  reproduce it (React flushes passive effects there), so it was not worth
  adding. The existing route tests now pin the behavior.
- No open questions.

## Review (written by Claude)

**Approved.** Clean pre-review, no fix rounds.

**Cause:** the Escape fired between the commit and the passive effect that attaches the kit `Dialog`'s document listener. It was not a stale `AddContactDialog`.

**Fix:** the test now waits for the effect's focus move before pressing Escape. 30 runs under load passed with 0 failures.

**Follow-up in T-0282:** the shared modal hook attaches the listener in a layout effect, so the race is gone in the product too.

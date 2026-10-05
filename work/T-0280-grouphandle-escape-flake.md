---
id: T-0280
title: "Web tests: the GroupHandleRoute Escape tests stop flaking under load"
status: todo
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

## Review (written by Claude)

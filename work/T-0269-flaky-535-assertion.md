---
id: T-0269
title: "Server tests: the 'no provider detail' checks stop matching '535' inside the random requestId"
status: merged
milestone: M5
branch: task/T-0269-flaky-535-assertion
model: auto
effort: low
depends_on: []
estimate: 0.05 day
---

# T-0269: flaky "535" assertions

## Spec (written by Claude, do not edit)

### Why
CI on main failed once (the T-0257 merge run) on `apps/server/src/setup/routes.test.ts` > "rolls the settings back and answers 422 when the test send fails" with `expected '{"error":{"code":"mail_send_failed",…' not to contain '535'`. The error body carries a random UUID `requestId` (`apps/server/src/app.ts` lines 246, 256 and 566), so the substring "535" shows up by chance in roughly 1 run out of 140.

### Verified facts (do not re-derive)
- `apps/server/src/setup/routes.test.ts`: `failingSend` throws `new Error('535 rejected: bad key')` (lines 31-35). The test at lines 193-203 checks `expect(raw).not.toContain('535')`.
- `apps/server/src/integrations/routes.test.ts`: the same pattern, a throw at line 417 and the check at line 428.

### What to build
In both tests, keep the intent (no provider detail in the response) without matching the random id:
- assert that the body does not contain `'535 rejected'` and does not contain `'bad key'`;
- or parse the body and check that `error.message` and the other fields except `requestId` do not contain `'535'`.
Keep every other assertion.

### Read first
`AGENTS.md`, the two tests.

### Allowed files
`apps/server/src/setup/routes.test.ts`, `apps/server/src/integrations/routes.test.ts`, `work/T-0269-flaky-535-assertion.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/routes.test.ts src/integrations/routes.test.ts
pnpm gate
```

### Acceptance
- Both tests still fail if the provider's error text leaks, and never fail because of the request id.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files. Do not touch `pnpm-lock.yaml`.

---

## Report (written by the worker when done)

### What I did
Replaced the flaky `expect(raw).not.toContain('535')` checks (which could
match the random UUID `requestId` in the error body) with assertions on the
provider's actual error text, in both tests:
- `apps/server/src/setup/routes.test.ts` (was line 203), in
  "rolls the settings back and answers 422 when the test send fails".
- `apps/server/src/integrations/routes.test.ts` (was line 428), in
  "a failed test send answers 422 and stores nothing".

Each now asserts `not.toContain('535 rejected')` and
`not.toContain('bad key')`. The injected failing send throws
`new Error('535 rejected: bad key')`, so the test still fails if the provider
detail leaks, but it can no longer fail because the random `requestId`
happens to contain the digits "535". All other assertions are unchanged.
No comment or other change was made beyond the new two-line check.

### Files changed
- `apps/server/src/setup/routes.test.ts`
- `apps/server/src/integrations/routes.test.ts`
- `work/T-0269-flaky-535-assertion.md` (status + this report)

### Commands run
- `pnpm install` -> succeeded, `Done in 16.5s`, 1170 packages added.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/setup/routes.test.ts src/integrations/routes.test.ts` -> `Test Files 2 passed (2)`, `Tests 38 passed (38)`.
- `pnpm gate` (repo root) summary:
  ```
  gate: 3 changed file(s) against main
  PASS  install (frozen)  (10.7s)
  PASS  format  (67.1s)
  PASS  lint  (2.6s)
  PASS  typecheck  (15.8s)
  PASS  tests @zilar/server  (21.0s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Problems / deviations
None. I used the first option in the spec (assert on the provider error
text) since it keeps the existing raw-body check style. `pnpm-lock.yaml` was
not touched.

### Blocked / needs a decision
None.

## Review (written by Claude)

**Verdict:** Approved; the first pre-review was clean.
- Both tests now check for "535 rejected" and "bad key", not the bare digits.
- That keeps the leak check and can no longer match the random request id.

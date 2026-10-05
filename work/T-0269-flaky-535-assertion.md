---
id: T-0269
title: "Server tests: the 'no provider detail' checks stop matching '535' inside the random requestId"
status: todo
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

## Review (written by Claude)

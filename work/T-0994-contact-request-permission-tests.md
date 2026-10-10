---
id: T-0994
title: "Contact requests: a few permission tests (who may accept, decline, cancel; blocks; limits)"
status: merged
milestone: M5
branch: task/T-0994-contact-request-permission-tests
model: auto
effort: default
depends_on: [T-0983]
estimate: 0.25 day
---

# T-0994: Permission tests for contact requests

## Spec (written by Claude, do not edit)

### Why
Julio's rule (2026-10-10) keeps tests only for crucial code, and permissions are part of it. No test covers contact requests: T-0983's worker searched for one and found none. The service decides who can accept, decline and cancel a request, and what a block does.

### What to build
Create one new file, `apps/server/src/contact-requests/contact-requests.test.ts`, with these 5 tests and no more. Set it up the way `apps/server/src/roles/roles.test.ts` does: `createTestContext` (`apps/server/src/test-support.ts:248`) and `seedUser` (`apps/server/src/test-support/seed.ts:17`). Call the service functions in `apps/server/src/contact-requests/service.ts` directly.

1. **Only the recipient can accept.**
   - Setup: A sends a request to B (`createContactRequest`, `service.ts:62`, by B's handle).
   - `acceptContactRequest` (`service.ts:250`) rejects A and a third user C with the same 404 that `notFound()` gives (`errors.ts:7`).
   - With B it returns `status: 'accepted'`.
2. **Only the recipient can decline.** `declineContactRequest` (`service.ts:369`) rejects A and C with 404 and works for B.
3. **Only the sender can cancel.** `cancelContactRequest` (`service.ts:379`) rejects B and C with 404 and works for A.
4. **A block.** When A has blocked B (a row in `user_blocks`, the table read at `service.ts:97-100`), A's request to B fails with 409 `blocked` (`service.ts:102`).
5. **The pending limit.** After `MAX_PENDING_OUTGOING` (20, `queries.ts:12`) pending requests from A, the next one fails with 429 `too_many_requests` (`service.ts:130-132`).

Do not change any source file. If a test fails because the code is wrong, stop and report it in the Report; do not fix the code.

### Read first
`AGENTS.md`, `apps/server/src/contact-requests/service.ts`, `apps/server/src/contact-requests/queries.ts`, `apps/server/src/contact-requests/errors.ts`, `apps/server/src/roles/roles.test.ts` (the setup to copy), and `apps/server/src/test-support/seed.ts`.

### Allowed files
`apps/server/src/contact-requests/contact-requests.test.ts`, `work/T-0994-contact-request-permission-tests.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/contact-requests/contact-requests.test.ts
pnpm gate
```

### Acceptance
The Checks pass with 5 tests, and the Report pastes the vitest summary line.

---

## Report (written by the worker when done)

Status: done.

### What I did
Added `apps/server/src/contact-requests/contact-requests.test.ts` with exactly the 5 tests from the spec, calling the service functions directly against a `createTestContext` PGlite database. No source file was changed.

- Users are seeded with `seedUser`; each gets a live `handles` row (a local `seedHandle` helper) so `createContactRequest` can resolve the handle. The service deps are `{ db: context.db }`.
- Tests 1–3: a pending A→B request; A and a third user C get the same 404 shape `notFound()` builds (status 404, code `not_found`, message `Not found`); the correct side returns `accepted` / `declined` / `cancelled`.
- Test 4: a `user_blocks` row (A blocked B) makes A's request to B reject with 409 `blocked`.
- Test 5: 20 seeded pending rows from A, then a 21st `createContactRequest` rejects with 429 `too_many_requests` (`MAX_PENDING_OUTGOING` imported from the service, not hard-coded).

### Files changed
- `apps/server/src/contact-requests/contact-requests.test.ts` (new)
- `work/T-0994-contact-request-permission-tests.md` (Report + status)

### Commands run (real results)
`pnpm install` — done, no lockfile change.

```
pnpm --filter @zilar/server exec vitest run --maxWorkers=2 --reporter=dot src/contact-requests/contact-requests.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  4.79s
```

`pnpm gate` (from repo root):

```
gate: 2 changed file(s) against main
PASS  install (frozen)  (1.2s)
PASS  format  (1.2s)
PASS  lint  (1.0s)
PASS  typecheck  (3.6s)
SKIP effect (no source files changed)
PASS  tests @zilar/server  (5.9s)
scope: every changed file is inside the Allowed files
GATE PASS
```

### Problems / deviations
None. The code behaved as the spec describes; nothing needed fixing.

### Open questions
None.

## Review (written by Claude)

**Lead, 2026-10-10: approved. The pre-review is clean, with no nits.**
- **The tests:** five tests in `contact-requests/contact-requests.test.ts`:
  - only the recipient accepts and declines, and only the sender cancels; everyone else gets the same 404;
  - a request to someone the sender blocked gets 409 `blocked`;
  - the 21st pending request gets 429 `too_many_requests`.
- **No source change.** The permissions gap the lead found in T-0983 is closed.
- **Check:** `Tests 5 passed (5)`, and the gate passed.

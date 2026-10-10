---
id: T-0994
title: "Contact requests: a few permission tests (who may accept, decline, cancel; blocks; limits)"
status: todo
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

## Review (written by Claude)

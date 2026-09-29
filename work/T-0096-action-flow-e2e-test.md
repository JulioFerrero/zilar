---
id: T-0096
title: End-to-end test of the action flow through the real HTTP routes (tests only, server)
status: todo
milestone: M4
branch: task/T-0096-action-flow-e2e-test
model: minimax-coding-plan/MiniMax-M3
depends_on: [T-0090, T-0092, T-0093]
estimate: 0.5 day
---

# T-0096: Action flow end to end, through HTTP

## Spec (written by Claude, do not edit)

### Goal

The action gateway is tested by calling `onApprovalDecided` directly, and the approvals route is tested with a fake hook. Nothing proves the **whole chain through the real routes**: a tier-2 request creates an approval, a person decides it over `POST /api/approvals/:id/decision`, the route's `onDecided` hook fires the real gateway, and the adapter runs (or does not). This task adds that test. **Tests only: no production code changes.** If the test reveals a bug, do not fix it: stop, describe it in the Report under "Blocked / needs a decision", and set `status: blocked`.

### What to build

One new file `apps/server/src/actions/flow.e2e.test.ts` (Vitest, PGlite via `createTestContext`, no network). Build the app with `createApp({ ..., actionGateway })` where `actionGateway = createActionGateway({ db, adapters, audit, logger, announce })` with a **fake tier-2 adapter** (records every call, returns a summary), a fake tier-0 adapter and a **recording fake announcer**. Sign users in the way the other route tests do (`signUpWithInvite` / helpers in `test-support.ts` and `approvals/routes.test.ts`). Because the route runs the hook in the background, wait for the effect with a small polling helper (poll the `pending_actions` row or the adapter's call list, short interval, 2 s ceiling; never a bare long sleep).

Scenarios (each its own `it`, with a comment saying what it protects):
1. **Approve → executes once with the stored args.** Owner of the AI decides `approve_once`; the adapter is called exactly once with exactly the parsed args stored at request time; `pending_actions` ends `executed` with the summary; the announcer got `approvalRequested` then `outcome(executed)`; audit has `action.requested`, `approval.decided` and `action.executed` with the args hash and **no args text** anywhere in the audit rows.
2. **Deny → never runs.** Decide `deny`; adapter call list stays empty; row `cancelled`; announcer got `outcome(cancelled)`.
3. **A stranger cannot decide.** A second user's decision answers the 404 shape the approvals route uses for non-deciders; the adapter never runs; the row stays `waiting`; the owner can still approve afterwards and it runs once.
4. **Double decision is single execution.** Two approve requests in a row (the second answers the route's conflict shape) → adapter called exactly once.
5. **Stop between request and approval.** Request, then stop the AI (`POST /api/ais/:id/stop` as the owner, or update `ais.status` to `stopped` if the route needs LiteLLM in the test app), then approve → adapter never called, row `cancelled`, audit has `action.cancelled`.
6. **Expired approval.** Request, move the approval's `expires_at` into the past, decide → the decision is refused, adapter never called.
7. **Tier 0 needs no approval.** `request` runs the tier-0 adapter immediately and creates no approval row.
8. **Unknown action and invalid args** are denied (`unknown_action`, `invalid_args`) and leave **no** approval or pending rows.
9. **Args tampering at rest.** After a request, change `pending_actions.args_hash` (or the approval's) in the row so they disagree, then approve → adapter never called, row `cancelled`.
10. **Adapter throws.** Approve → row `failed`, the thrown message (use a distinctive string) appears in **no** row, audit entry, announcer call or HTTP response.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/actions/gateway.ts`, `gateway.test.ts` (harness style, seeding helpers), `apps/server/src/approvals/routes.test.ts` and `routes.ts` (how sign-in and decisions are done in tests), `test-support.ts`, `work/T-0090-action-gateway.md` and `T-0092-...md` Reviews

### Allowed files
- `apps/server/src/actions/flow.e2e.test.ts` (new)
- `work/T-0096-action-flow-e2e-test.md`

**Not allowed:** any production file, any other test file, dependencies.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server
```

### Acceptance criteria
- [ ] All ten scenarios exist and pass without flakiness (run the file three times in a row and report it).
- [ ] No fixed long sleeps; polling has a ceiling and a clear failure message.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

---

## Report (written by the worker when done)

### What I did
-

### Files changed
-

### Commands run and real results
-

### Problems, deviations from the spec, open questions
-

### Blocked / needs a decision
-

---

## Review (written by Claude)

**Verdict:**

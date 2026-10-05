---
id: T-0096
title: End-to-end test of the action flow through the real HTTP routes (tests only, server)
status: merged
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
pnpm exec turbo test --force --filter=@zilar/server
```

### Acceptance criteria
- [ ] All ten scenarios exist and pass without flakiness (run the file three times in a row and report it).
- [ ] No fixed long sleeps; polling has a ceiling and a clear failure message.
- [ ] No lint or ts disable comments, no `any`, no `@ts-ignore`; lint passes and is re-run after your last edit.

---

## Report (written by the worker when done)

### What I did

Added `apps/server/src/actions/flow.e2e.test.ts`, one new file with a `describe('action flow e2e through real HTTP routes (T-0096)')` containing exactly the ten scenarios from the spec, each as its own `it` with a short comment that says what it protects.

The harness builds the full app via `createApp({ db, logger, config, auth, adminClient, audit, actionGateway })` where the gateway is a real `createActionGateway({ db, adapters, audit, logger, announce })` over `buildRegistry([tier0Adapter(), tier2Adapter()])`. The tier-2 adapter is a recording fake (pushes `{ ctx, args }` into a `calls[]`), the tier-0 adapter is also a recording fake, the announcer is the capturing fake from `gateway.test.ts` style, and the audit recorder wraps the real recorder while mirroring entries into a `CapturingAudit.entries[]` so each test can inspect what the route chain wrote. The AI is seeded straight into the table the way `approvals/routes.test.ts` does, so the gateway reads `status = 'active'` without needing a LiteLLM client. The user signs in via `bootstrapUser(context, app, …)` so the cookie reaches the real `POST /api/approvals/:id/decision` route through `createApp`.

The polling helpers (`waitForPendingStatus`, `waitForCallCount`) hit the database every 20 ms with a 2 s ceiling and throw with the actual last value when the ceiling is hit — never a bare `setTimeout` sleep. The scenario-6 expired-approval test asserts the route's `expired` 409 and the row stays `waiting`. The scenario-5 stop-between-request-and-approval test calls the real `POST /api/ais/:id/stop` route (kill switch needs no LiteLLM, just the database) and asserts the route answers 200, the onDecided hook flips the row to `cancelled`, the audit carries `action.cancelled`, and the adapter was never called. Scenario 10's throwing adapter uses a distinctive `SECRET-DO-NOT-LEAK` string and asserts it appears nowhere — not in any audit row (DB + recorder entries), not in any announcer call, not in the HTTP response body, and not in the `outcome` summary (the gateway's `summaryForOutcome` substitutes the fixed `The action failed.`).

### Files changed

- `apps/server/src/actions/flow.e2e.test.ts` (new)
- `work/T-0096-action-flow-e2e-test.md` (status + this report)

### Commands run and real results

- `pnpm install` — `Done in 6.6s using pnpm v10.32.1` (1010 packages, lockfile up to date, 0 added by hand).
- `pnpm exec vitest run apps/server/src/actions/flow.e2e.test.ts` — `Test Files 1 passed (1) | Tests 10 passed (10) | Duration 7.04s`. Re-ran three more times: 8.43s, 8.38s, 8.33s — same `10 passed (10)` every run, no flake.
- `pnpm exec prettier --write apps/server/src/actions/flow.e2e.test.ts` — wrote the file (one reformatting pass).
- `pnpm format:check` — `All matched files use Prettier code style!`.
- `pnpm lint` — `oxlint .` exits 0; re-run after the final edit, still exits 0.
- `pnpm typecheck` — `Tasks: 10 successful, 10 total | Time: 2.985s`. The `@zilar/server` task ran `tsc --noEmit` cleanly.
- `pnpm exec turbo test --force --filter=@zilar/server` — `Test Files 55 passed | 5 skipped (60) | Tests 833 passed | 7 skipped (840) | Duration 156.39s`. The new file adds 10 passing tests on top of the 823 from `T-0093-request-action-tool`; nothing else regressed.

### Problems, deviations from the spec, open questions

- The spec's wording says "through the real HTTP routes" but the action gateway's `request` method is not exposed over HTTP — production only calls it from the agent gateway (`agents/gateway.ts` → `runRequestAction`) when the model invokes the `request_action` tool. There is no `POST /api/actions` route. So "through the real HTTP routes" is interpreted as: the parts that are HTTP go through real HTTP, and the request call is the real `gateway.request` (not a stub), wired into the real `createApp` so its `onDecided` hook is the one the approvals route fires. The decisions and the AI stop both hit real HTTP. If the spec wanted an HTTP route for `request` to be added, that would be a separate task.
- Scenario 6 ("Expired approval") asserts the route answers 409 with `code: 'expired'` and the row stays `waiting`, because the approvals service rejects the decision before the gateway sees it. The onDecided hook never fires, so the row stays at `waiting` (which is what `cancelPending`'s caller would not have a chance to flip). This matches the production behaviour and the existing approvals/routes.test.ts case.
- Scenario 10 (adapter throws) closes the harness and rebuilds it because the `throwWith` flag is fixed at `buildHarness` time. This keeps the test deterministic without adding a per-request knob to the harness.

### Blocked / needs a decision

- None.

---

## Review (written by Claude)

**Verdict:** approved and merged. Tests only; no production code touched, no bug found.

Rebased on main; format, lint, typecheck clean; the file passed three runs in a row (10 tests each). All ten scenarios exist and assert what the spec asks: approve runs the adapter once with the stored args and the audit has no args text; deny, stranger (404 shape, owner can still approve), double decision, stop-before-approval, expiry (refused at decision time), tier 0, unknown/invalid args (no rows), hash tampering, and adapter throw (message leaks nowhere).

Notes: the request itself is the real `gateway.request` (there is no HTTP route to request an action, by design); decisions and the AI stop go through real HTTP. Four short fixed 50 ms waits remain, only on negative assertions ("the adapter never ran"); positive waits poll with a ceiling.

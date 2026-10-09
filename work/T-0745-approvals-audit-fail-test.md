---
id: T-0745
title: "main CI red since T-0738: approvals/routes.test 'still answers 200 when the audit recorder fails' rejects the 4th sqlRuntimeFor call, which is no longer the audit INSERT (login now also runs on effect/sql); inject the failure through a recorder on an unregistered db instead of a call counter"
status: merged
milestone: M5
branch: task/T-0745-approvals-audit-fail-test
model: auto
effort: low
depends_on: [T-0738]
estimate: 0.05 day
---

# T-0745: make the audit-failure test independent of query order

## Spec (written by Claude, do not edit)

### Why
CI on main has been red since T-0738 (run 37903741977, `a05fe484`). The failing test is `src/approvals/routes.test.ts` › "still answers 200 when the audit recorder fails": `expected 500 to be 200`. The lead bisected it to T-0738 (`71b60abc`), and it fails 3 out of 3 times locally. The merge gate missed it because it runs only the tests near the changed files.

### Verified facts (do not re-derive)
- `apps/server/src/approvals/routes.test.ts:603-617` counts `sqlRuntimeFor` calls and rejects call number 4, assuming it is the audit INSERT. Line 638 then asserts `expect(calls).toBe(4)`.
- Since T-0738, `auth.ts` uses the effect/sql adapter, so the session lookup also goes through `sqlRuntimeFor`. The 4th call is now an earlier query, and the route answers 500.
- `createAuditRecorder({ db, logger, now })` (`apps/server/src/audit/service.ts:169-184`) catches any error from `recordAudit(db, …)` and logs it. `recordAudit` (line 190) runs through `runSql(db, …)`, which uses `sqlRuntimeFor(db)`.
- `sqlRuntimeFor(db)` throws `No effect/sql runtime registered for this database` for a db with no registered runtime (`apps/server/src/effect/sql.ts:98-102`).

### What to build
In that one test (`approvals/routes.test.ts:587-655`):
1. Remove the call counter: `passthrough`, `calls`, the `mockImplementation` and its restore in `finally`.
2. Build the recorder on a stand-in database with no runtime, for example `const unregisteredDb = {} as unknown as ServerDatabase` (import the type if needed), then `createAuditRecorder({ db: unregisteredDb, logger: { error: … } })`.
3. Make the logger record its calls, and assert that it logged `'audit write failed; carrying on'` exactly once. This proves the failure really happened.
4. Keep the remaining assertions: status 200, and no `audit_log` rows.

Change no other test. The file-level `vi.mock` of `../effect/sql` stays, because other tests in the file use it.

### Read first
`AGENTS.md`, `apps/server/src/approvals/routes.test.ts` (lines 1-40 and 580-660), `apps/server/src/audit/service.ts` (lines 160-200).

### Allowed files
`apps/server/src/approvals/routes.test.ts`, `work/T-0745-approvals-audit-fail-test.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals
pnpm gate
```

### Acceptance
- All tests in `src/approvals` pass, with the same number of tests as before.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did.** In `apps/server/src/approvals/routes.test.ts`, the test "still answers 200 when the audit recorder fails" no longer counts `sqlRuntimeFor` calls. The recorder now runs on `unregisteredDb = {} as unknown as ServerDatabase`, so every audit write throws "No effect/sql runtime registered" before SQL. The logger records its messages, and the test asserts `['audit write failed; carrying on']` (exactly one log line), then status 200 and zero `audit_log` rows. Removed: the `passthrough`/`calls` counter, the `mockImplementation`, and the `try`/`finally` restore. Removed the now-unused `sqlRuntimeFor` import and added `import type { ServerDatabase } from '../db/client'`. No other test changed. The file-level `vi.mock('../effect/sql')` is kept as the spec says.

**Files changed.** `apps/server/src/approvals/routes.test.ts`, `work/T-0745-approvals-audit-fail-test.md`.

**Commands and results.**
- `pnpm install`: done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals`, before: 1 failed, 126 passed (127 total, 7 files). The failure was "expected 500 to be 200" at the status assertion.
- Same command, after prettier: 7 files passed, 127 passed (127 total).
- `pnpm exec prettier --write apps/server/src/approvals/routes.test.ts`: unchanged.
- `pnpm gate` (from the worktree root, `cwd` checked): summary lines:
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`, `PASS format`, `PASS lint`, `PASS typecheck`, `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Single tests run.** Only the `src/approvals` filter above, with `--reporter=dot`, plus `pnpm gate`.

**Deviations and open points.**
- The comment on the file-level `vi.mock` (lines 24-26, "A test can break the runtime for the next call") is now stale, since no test uses that capability. I left it because the spec keeps the mock and says to change no other code. Say if you want the comment reworded.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 3.3 min). The lead reviewed the diff directly.
- **The fix:** the call counter is gone. The recorder now runs on an unregistered db, the test asserts the failure was logged exactly once, and it keeps the 200 and zero-rows assertions.
- **Tests:** `src/approvals` has 127 tests; 126 passed before (with this one failing) and all 127 pass after. The gate passed.
- **Follow-up, not here:** `voice-transcription/pipeline.test.ts` "a fetch that never starts" waits 20 s of real time in CI (run 37890484924), and its `TestClock` does not reach the inner runtime. It times out under the local 5 s limit. Other counter seams worth a look: `setup/routes.test.ts:265`, `agents/gateway.test.ts:2270` and `actions/recovery-loop.effect.test.ts:35`.

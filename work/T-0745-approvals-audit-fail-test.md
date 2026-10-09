---
id: T-0745
title: "main CI red since T-0738: approvals/routes.test 'still answers 200 when the audit recorder fails' rejects the 4th sqlRuntimeFor call, which is no longer the audit INSERT (login now also runs on effect/sql); inject the failure through a recorder on an unregistered db instead of a call counter"
status: todo
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

## Review (written by Claude)

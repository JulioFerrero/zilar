---
id: T-0692
title: "test gap from T-0688: creating a public group with a handle another group retired (still reserved) answers 409 handle_taken and writes nothing; plus the ais machine-row type nit from T-0677"
status: merged
milestone: M5
branch: task/T-0692-retired-handle-create-test
model: auto
effort: low
depends_on: [T-0688]
estimate: 0.05 day
---

# T-0692: retired-handle test and an ais type nit

## Spec (written by Claude, do not edit)

### Why
T-0688 moved `createGroup` onto effect/sql. Its handle branch "retired by another group, still reserved, so 409" has no test (the T-0688 Review). T-0677 also left a wrong row type.

### Verified facts (do not re-derive)
- **`apps/server/src/groups/service.ts` `createGroup`:** for a public create, it reads `retired_handles` by `handle_lower`. If `reserved_until` is in the future and `former_group_id` is another group, it fails with `HttpError(409, 'handle_taken', 'That handle is taken')` inside the transaction, so nothing is written.
- **`apps/server/src/groups/visibility.test.ts:311-354`** ("going private retires the handle for 30 days…") shows how to retire a handle (patch public with a handle, then patch private) and has helpers such as `ownedGroup()`, `patchGroupRequest`, `createGroupRequest` and `bootstrapUser`. The public-create request shape is the test at line 135 ("creates a public group with a handle in one request").
- **`apps/server/src/ais/service.ts`** (about line 850, `assignMachine`) types the machine row as `sql<{ owner_user_id: string; status: string }>`, but the client camelCases result names, and only `status` is read.

### What to build
1. **In `groups/visibility.test.ts`, add one test:**
   - group A goes public with handle `kept_pub`, then private, which retires the handle;
   - a stranger then creates a **public** group with handle `kept_pub` in one request (as in the line-135 test), and it answers 409 with error code `handle_taken`;
   - no new `groups` row with that title exists, and no `handles` row points to a new group.
2. **In `ais/service.ts`,** change that row type to `sql<{ status: string }>` and select only `status`. Keep the `WHERE` clause as it is.
3. **No other change.**

### Read first
`AGENTS.md`, `apps/server/src/groups/visibility.test.ts` (lines 1-140 and 300-360), `apps/server/src/ais/service.ts` (about lines 840-870).

### Allowed files
`apps/server/src/groups/visibility.test.ts`, `apps/server/src/ais/service.ts`, `work/T-0692-retired-handle-create-test.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test src/ais/service.test
pnpm gate
```

### Acceptance
- The new test passes, and it would fail if the reservation check were removed. Say in the Report how you checked that, for example by flipping the check locally and reverting.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

### What I did
1. `apps/server/src/groups/visibility.test.ts`: added the test "refuses a public create on a handle another group retired and still reserves" (placed after the going-private test). Group A goes public with `kept_pub`, then private (retires the handle). A stranger creates a public group with `kept_pub` and gets 409 `handle_taken`. Then it checks that no `groups` row with title "Retired create" exists and every `handles` row for `kept_pub` points to group A. Added `handles` to the schema import.
2. `apps/server/src/ais/service.ts` (`assignMachine`, around line 850): row type is now `sql<{ status: string }>` and the select is `SELECT status`. The `WHERE` clause is unchanged.
3. No other files changed. `apps/server/src/groups/service.ts` was flipped temporarily and reverted; `git diff` on it is empty.

### Commands and results
- `pnpm install`: exit 0, "Done in 15.7s".
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/groups/visibility.test src/ais/service.test`: 2 files passed, 51 tests passed.
- Acceptance check: I changed `if (reserved && retired.formerGroupId !== groupId)` to `if (false && reserved && ...)` in `apps/server/src/groups/service.ts`, then ran `... src/groups/visibility.test -t "retired and still reserves"`. Result: 1 failed (`AssertionError: expected 201 to be 409`). I reverted the flip; `git diff -- apps/server/src/groups/service.ts` is empty.
- `pnpm gate` (log kept in the scratchpad, not in the worktree), exit 0. Summary lines:
  - `gate: 3 changed file(s) against main`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

### Problems, deviations, open questions
- None. The spec's Checks list the two test files, and I ran them as written.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 2.3 min). The lead reviewed the diff directly.
- **New test:** after a group retires its handle, a stranger who creates a public group with that handle gets 409 `handle_taken`, and no group with that title is written. The worker showed the test fails (201) when the check is disabled.
- **ais nit:** the `assignMachine` row type now selects only `status`.
- **Note:** the test reads rows through drizzle, as its file does. The T-0691 plan converts the tests.

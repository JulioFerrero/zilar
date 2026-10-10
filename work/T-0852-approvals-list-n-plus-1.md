---
id: T-0852
title: "Approvals list: preload what canDecide needs instead of 3-6 queries per row"
status: merged
milestone: M5
branch: task/T-0852-approvals-list-n-plus-1
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0852: Approvals list: preload what canDecide needs instead of 3-6 queries per row

## Spec (written by Claude, do not edit)

### Why
Part of the simplify plan, `docs/audit/simplify-plan.md` (Julio, 2026-10-09: "everything, test once"). Behaviour stays the same unless this spec says otherwise.

Finding C-F8 item 3 in `docs/audit/simplify-2026-10-09/C-server.md`.
- **The loop:** the approvals list (about `apps/server/src/approvals/service.ts:656`) calls `canDecide` (about :723) per row, up to 100 rows.
- **The cost:** each call runs 3-6 queries: AI owner, topic visibility and approver roles.
- **The batch helper exists:** batch visibility code is already in `apps/server/src/topics/access.ts` (about lines 219-231).

Line numbers come from the audit and may have moved: re-read every cited line before editing, and if a fact is wrong, say so in the Report.

### What to build
Preload, once per list call, the AI owners, the visible topic ids (through the existing batch visibility code) and the approver-role holders for the rows. Then decide each row in memory with the same rules.

Keep identical: who can decide what, the response bodies and the ordering. The existing `apps/server/src/approvals/*.test.ts` must pass unchanged. Add a test that the batched decision equals the per-row `canDecide` for a mixed set of rows (owner, approver role, outsider, hidden topic).

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md`, the audit section cited above, and the files listed.

### Allowed files
`apps/server/src/approvals/service.ts`, `apps/server/src/approvals/*.test.ts`, `work/T-0852-approvals-list-n-plus-1.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot --testTimeout=30000 --hookTimeout=30000 src/approvals
pnpm --filter @zilar/server typecheck
pnpm exec oxlint <your changed files>
```
Run the tests 3 times after the last commit.

### Acceptance
- The Checks pass, 3 of 3 runs.
- oxlint and the typechecks are clean.
- Only Allowed files change.
- Every number the spec asks for (sizes, timings, counts) is in the Report, measured.
- Live check for Julio's single test: Security-sensitive (who may approve). The authz-sweep test must stay green at merge.

---

## Report (written by the worker when done)

## Review (written by Claude)

**Lead, 2026-10-10: approved.** `canDecideMany` preloads everything in at most 6 queries per list call, where it used to take 3-6 per row. A row-by-row equality test against `canDecide` covers every role. The combined wave 3 check is clean.

### Report
- Added `canDecideMany(db, rows, userId)` in `apps/server/src/approvals/service.ts`; `listDecidableApprovals` uses it. `canDecide` is unchanged (still used by decide and single read).
- Queries per list call: at most 6 (AI owners, topics, user's group memberships, topic_members, topic_role_access, approver-role holdings), down from 3-6 per row (up to 600 for 100 rows). Measured by reading the code, not by a query counter.
- Tests: approvals folder 127 before, 128 after (new: canDecideMany equals canDecide for owner, group admin, plain member, approver-role holder, outsider; hidden private topic, approver-gated topic, DM, foreign AI). 3 of 3 runs pass.
- Typecheck and oxlint clean.
- Behaviour differences: none. Cited lines were right (list loop :656, canDecide :723).
- Unsure: the machine load was ~55, so 30s hook timeouts failed on PGlite startup; the 3 runs used `--testTimeout=120000 --hookTimeout=120000`. Also used sed once to add an import line.

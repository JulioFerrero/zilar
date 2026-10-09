---
id: T-0727
title: "tests off drizzle (approvals (routes, rules.routes, rules)): replace every drizzle query in approvals/routes.test.ts, approvals/rules.routes.test.ts, approvals/rules.test.ts with testSql(context) + effect/sql; drop the drizzle-orm and db/schema imports"
status: merged
milestone: M5
branch: task/T-0727-approvals-b-tests-off-drizzle
model: auto
effort: low
depends_on: [T-0695]
estimate: 0.1 day
---

# T-0727: approvals (routes, rules.routes, rules) tests off drizzle

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. No server module uses drizzle any more, but the tests still read and seed rows through it. `docs/audit/drizzle-removal-plan.md` §5, phase 1, moves them folder by folder onto the `testSql` helper (H1, T-0695). This task is the approvals (routes, rules.routes, rules) folder.

### Verified facts (do not re-derive)
- `apps/server/src/approvals/routes.test.ts` (1010 lines): drizzle at lines 3, 5, 22, 23, 52, 62, 74, 501, 541, 565, 613, 725, 731, 735, 737, 750, 842, 847, 848, 850, 856, 860, 884, 911, 913, 919, 922, 930, 942, 945, 977, 1004.
- `apps/server/src/approvals/rules.routes.test.ts` (981 lines): drizzle at lines 3, 17, 44, 54, 66, 77, 83, 91, 94, 368, 448, 520, 654, 656, 658, 705, 855, 891, 903, 968.
- `apps/server/src/approvals/rules.test.ts` (1171 lines): drizzle at lines 3, 17, 35, 46, 59, 69, 81, 92, 98, 106, 110, 132, 240, 264, 285, 295, 609, 611, 644, 676, 731, 736, 773, 778, 793, 794, 898, 906, 909, 942, 961, 1063, 1098.
- **`testSql(context)`** is in `apps/server/src/test-support.ts` (T-0695). Use it as `await testSql(context)(Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* sql<Row>\`...\`; }))`, with the imports `import { Effect } from 'effect'; import { SqlClient } from 'effect/sql';`. The worked example is `apps/server/src/pins/pins.test.ts`.
- **Results come back camelCased** (`transformResultNames`, `apps/server/src/effect/sql.ts:56`), and the SQL must name the **snake_case** columns. Keys passed to `sql.insert(...)` must be snake_case too. `"user"` must be quoted. Use `count(*)::int` for counts, and `${JSON.stringify(value)}::jsonb` for jsonb.
- **Drizzle filled some columns in JavaScript** (`$defaultFn`, `$onUpdate` in `apps/server/src/db/schema.ts`). The database does not, so a raw insert must give those values itself: check each table's columns in `schema.ts`. Columns with a SQL default (`defaultNow()`, `default(...)`) can be left out.

### What to build
1. **In each file above,** replace every drizzle query (seed inserts, updates, deletes, reads used by assertions) with `testSql(context)(...)`. Keep the same rows, values, order and assertions. Select only the columns a test reads, and give them a small local row type.
2. **Remove** the `drizzle-orm` and `../db/schema` imports, including any dynamic `import('../db/schema')`.
3. **Leave alone** the lines that pass `context.db` to a module function (`db: context.db`, `claimHandle(context.db, …)`): they are not drizzle queries.
4. **Values whose JS type differs** from drizzle (timestamps, numerics, jsonb): adapt only the read, never the meaning of an assertion. If a test cannot pass without changing what it checks, stop and ask (status: blocked).
5. **A test that patches `context.db.transaction` or another drizzle method** to inject a failure no longer reaches the module, because the modules run on effect/sql. Move it to the proven seam: a partial `vi.mock` of the effect/sql module that wraps `sqlRuntimeFor` in `vi.fn(actual.sqlRuntimeFor)`, then `mockReturnValueOnce({ runPromise: () => Promise.reject(err) } as never)` right before the call. See `apps/server/src/setup/routes.test.ts:25-30` and `apps/server/src/app.test.ts` (the down-database test). Keep what the test asserts.

### Read first
`AGENTS.md`, `docs/audit/drizzle-removal-plan.md` §2 (lines 249-390), `apps/server/src/pins/pins.test.ts` (the worked example), the files above, and the matching tables in `apps/server/src/db/schema.ts`.

### Allowed files
`apps/server/src/approvals/routes.test.ts`, `apps/server/src/approvals/rules.routes.test.ts`, `apps/server/src/approvals/rules.test.ts`, `work/T-0727-approvals-b-tests-off-drizzle.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/approvals/routes.test.ts src/approvals/rules.routes.test.ts src/approvals/rules.test.ts
pnpm gate
```

### Acceptance
- `git grep -n "drizzle-orm\|db/schema" -- apps/server/src/approvals/routes.test.ts apps/server/src/approvals/rules.routes.test.ts apps/server/src/approvals/rules.test.ts ` prints nothing.
- The same number of tests pass as before (give the counts before and after in the Report).
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

All three approvals test files are off drizzle: every seed/assertion query now
uses `testSql(context)` + `effect/sql` with snake_case columns and small local
row types; `drizzle-orm` / `../db/schema` imports are gone; `context.db` passed
to module functions is untouched.

- `routes.test.ts` (I did this file): `seedAi` (provider_connections/ais/
  ai_limits), `seedPrivateTopic` (groups/group_members/group_ais/topics/
  topic_members), decided_by read, 4× audit_log reads, group_members +
  `"user"` name updates + group_roles/group_member_roles inserts + topics
  approver_role_id updates (×2 tests), group_members DELETE, topic_members
  DELETE, Logos second-topic seed. The "audit recorder fails" test now injects
  at the effect/sql seam: partial `vi.mock('../effect/sql')` wrapping
  `sqlRuntimeFor`, counting calls and rejecting the 4th `runPromise` (SELECT
  approvals, SELECT ais owner, decision transaction, then the audit INSERT).
  Same assertion (200 + zero audit rows). `"user"` quoted; numeric/date reads
  needed no adaptation (no numerics read; timestamps still Dates).
- `rules.routes.test.ts` (helper subagent): seedAi/seedGroup raw inserts,
  revoked_at / audit_log / approvals-status / approval_rules reads, approvals
  expires_at UPDATE, topics+topic_members seeds, topic_members DELETE. 23/23.
- `rules.test.ts` (helper subagent): seedUser (`"user"`), seedAi, seedGroup,
  seedTopic, topic_ais inserts; approval_rules/audit_log/approvals reads,
  count(*)::int, ais status UPDATE, ais/group_ais DELETEs. 30/30. I ran
  `prettier --write` on this file to fix the gate format check (whitespace
  only), re-ran its tests: 30/30 still green.

Commands (real results):
- Baseline before changes: 3 files, 73 passed.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot
  src/approvals/routes.test.ts src/approvals/rules.routes.test.ts
  src/approvals/rules.test.ts`: 3 passed, 73 passed (20 + 23 + 30) — same
  count as before.
- `pnpm gate`: GATE PASS (install PASS, format PASS, lint PASS, typecheck
  PASS, tests @zilar/server PASS); "scope: every changed file is inside the
  Allowed files".
- Acceptance grep `git grep -n "drizzle-orm\|db/schema" -- <three files>`:
  prints nothing.

Security checklist: no secrets touched; deletes/updates all scoped by
group_id/topic_id/id; no new routes; audit assertions unchanged (ids only).
No deviations: no assertion meaning changed; no new dependencies.

## Review (written by Claude)

**2026-10-09, lead:** approved. The pre-review was clean (packet head 0d9b38bd), and all 73 tests pass.
- **Nit, accepted:** the audit-failure test breaks the 4th `sqlRuntimeFor` call. The trace is right, and any drift fails loudly.
- **Follow-up:** that test should assert the call count, as `setup/routes.test.ts:275` does.

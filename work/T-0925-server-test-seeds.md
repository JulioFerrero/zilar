---
id: T-0925
title: "Server tests: one shared seed module (seedUser, seedAi, seedGroup with overrides) in apps/server/src/test-support, first used by approvals/ and tools/ (simplify plan 5.4, F-F4)"
status: todo
milestone: M5
branch: task/T-0925-server-test-seeds
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-0925: Shared server test seeds, part 1

## Spec (written by Claude, do not edit)

### Why
This is simplify plan item 5.4, the server half (`docs/audit/simplify-plan.md` Phase 5; report `docs/audit/simplify-2026-10-09/F-tests.md` F4). Each server test file writes its own raw-SQL seed helpers. The lead counted on main on 2026-10-10: `seedAi` is defined in 27 test files, `seedGroup` in 15 and `seedUser` in 7, so a column change touches dozens of files. The copies also differ in defaults.

This first task builds the shared module and moves two directories to it. The seed helpers there:
- **`apps/server/src/approvals/`:**
  - `service.test.ts`: `seedUser` `:40`, `seedAi` `:58`, `seedGroup` `:100`;
  - `rules.test.ts`: `:44`, `:57`, `:94`;
  - `rules.routes.test.ts`: `seedAi` `:51`, `seedGroup` `:67`;
  - `routes.test.ts`: `seedAi` `:54`;
  - `sweeper.test.ts`: `seedUser` `:32`, `seedAi` `:43`;
  - `sweeper.effect.test.ts`: `:21`, `:32`.
- **`apps/server/src/tools/`:**
  - `service.test.ts`: `seedAi` `:74`, `seedGroup` `:89`;
  - `routes.test.ts`: `:27`, `:42`;
  - `adapters.test.ts`: `:77`, `:92`.

Shared test code already lives in `apps/server/src/test-support.ts` (`createTestContext` `:307`, `testSql` `:302`) and the `apps/server/src/test-support/` folder (`wait.ts`).

### What to build
1. **A new `apps/server/src/test-support/seed.ts`** with `seedUser`, `seedAi` and `seedGroup`:
   - each takes the `TestContext` and an `overrides` object for every column the copies above set differently;
   - each returns what the callers need (ids, and the AI's JID);
   - it writes through `testSql` and SqlClient, and reuses the row types from `apps/server/src/db/rows.ts` where they fit.
   - Add `apps/server/src/test-support/seed.test.ts`, a short test that each helper inserts a row and that the overrides apply.
2. **Move the 9 files above** onto it: delete each local copy and call the shared helper, passing overrides wherever a copy's defaults differ (for example a different `ai_limits`, name or status). The assertions and the test count of each file stay the same.
3. **Report:**
   - each default that differed between the copies, and which override keeps it;
   - the lines removed;
   - the test counts before and after per file.

### Read first
`AGENTS.md`, `docs/EFFECT_BRIEF.md` (never use `git stash`; use the `test-support/wait.ts` helpers), `apps/server/src/test-support.ts`, `apps/server/src/db/rows.ts`, and the 9 test files.

### Allowed files
`apps/server/src/test-support/seed.ts`, `apps/server/src/test-support/seed.test.ts`, `apps/server/src/approvals/service.test.ts`, `apps/server/src/approvals/rules.test.ts`, `apps/server/src/approvals/rules.routes.test.ts`, `apps/server/src/approvals/routes.test.ts`, `apps/server/src/approvals/sweeper.test.ts`, `apps/server/src/approvals/sweeper.effect.test.ts`, `apps/server/src/tools/service.test.ts`, `apps/server/src/tools/routes.test.ts`, `apps/server/src/tools/adapters.test.ts`, `work/T-0925-server-test-seeds.md`.

### Checks (wave mode)
```bash
pnpm --filter @zilar/server exec vitest run --reporter=dot src/test-support src/approvals src/tools
pnpm --filter @zilar/server typecheck
pnpm exec prettier --check <your changed files>
pnpm exec oxlint <your changed files>
```

### Acceptance
- The Checks pass.
- Each moved file keeps its test count.
- No production file changes.
- The Report lists the differing defaults and the lines removed.

---

## Report (written by the worker when done)

## Review (written by Claude)

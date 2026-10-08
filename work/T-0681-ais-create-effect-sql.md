---
id: T-0681
title: "effect/sql: move the last drizzle in ais/service.ts (createAi's four statements and compensateCreate's delete) onto effect/sql; the file drops drizzle"
status: merged
milestone: M5
branch: task/T-0681-ais-create-effect-sql
model: auto
effort: low
depends_on: [T-0677]
estimate: 0.15 day
---

# T-0681: createAi on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. After T-0677, `ais/service.ts` uses drizzle only in `createAi` and `compensateCreate`. (`withAiEnsureLock` is an in-memory lock with no database calls; the header comment wrongly lists it.)

### Verified facts (do not re-derive)
- **`apps/server/src/ais/service.ts` `createAi`** (line 281) runs these drizzle statements on `deps.db`, with no transaction:
  1. `INSERT INTO ais (id, owner, name, template, persona, provider_connection_id, model, localpart, jid, status)` with `status = 'disabled'` (about line 316);
  2. `INSERT INTO ai_limits (ai_id, per_day_usd, per_month_usd)` with `usd(...)` strings (about line 328);
  3. inside the provisioning `try`, `INSERT INTO llm_virtual_keys (ai_id, litellm_key_id, litellm_model_id, encrypted_key, budget_usd, budget_duration)` (about line 371);
  4. `UPDATE ais SET status = 'active', updated_at = now WHERE id` (about line 381).

  A failure in step 3 or 4 lands in the existing `catch`, which calls `compensateCreate` and keeps its error mapping.
- **`compensateCreate`** (about line 1322) runs one drizzle statement, `DELETE FROM ais WHERE id = context.id` (about line 1376).
- **The rest of this file** uses `runSql` (line 27) with statements written as `` sql`…` ``, and timestamps as `${new Date()}`.
- **Line 13** imports `aiLimits, ais, llmVirtualKeys` from `../db/schema`, and drizzle `eq` is imported near the top. After this task nothing else should use them.
- **Tests:** `apps/server/src/ais/service.test.ts` and `apps/server/src/ais/routes.test.ts` (create, rollback, 502).

### What to build
1. **Rewrite the five statements** with `runSql`, with the same columns and values, in the same order and position (steps 3 and 4 stay inside the `try`, so a failure still runs `compensateCreate`).
2. **Remove** the drizzle and `../db/schema` imports.
3. **Fix the header comment:** the file is fully on effect/sql.

### Read first
`AGENTS.md`, `apps/server/src/ais/service.ts` (lines 1-40, 275-410, 1320-1380).

### Allowed files
`apps/server/src/ais/service.ts`, `work/T-0681-ais-create-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais
pnpm gate
```

### Acceptance
- `ais/service.ts` has no drizzle or `db/schema` import.
- The ais tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

**What I did**
- `apps/server/src/ais/service.ts`: the five statements in `createAi` (ais insert, ai_limits insert, llm_virtual_keys insert, ais status update) and the one in `compensateCreate` (`DELETE FROM ais`) now run through `runSql` with `` sql`…` `` statements, same columns, values and order. Steps 3 and 4 are still inside the provisioning `try`, so a failure there still runs `compensateCreate` and the 502 mapping. Timestamps use `${new Date()}`.
- Removed the `drizzle-orm` import (`eq`) and the `../db/schema` import (`aiLimits, ais, llmVirtualKeys`).
- Rewrote the header comment: every database call in the file runs on effect/sql. It no longer lists `withAiEnsureLock`.
- One comment at about line 471 (the `updateAi` COALESCE note) still says "the drizzle `set({...})` built before". It is a historical note, not an import, so I left it. Say if you want it removed.

**Files changed**
- `apps/server/src/ais/service.ts`
- `work/T-0681-ais-create-effect-sql.md` (status and this Report)

**Commands run (real results)**
- `pnpm install`: done.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais`: 4 test files passed, 1 skipped (`integration.test.ts`, which is gated by `ZILAR_AIS_INTEGRATION=1` and needs a real server). Tests: 96 passed, 2 skipped. `service.test.ts`, `routes.test.ts`, `litellm-model.test.ts` and `usage.test.ts` pass unchanged. The create rollback tests in `routes.test.ts` (lines 569, 590, 607, 636: XMPP account, roster, virtual key, model failures) and the 502 tests pass.
- `pnpm gate` (run from the worktree root, log kept in the scratchpad, not in the worktree):
  - `gate: 2 changed file(s) against main`
  - `PASS install (frozen)`
  - `PASS format`
  - `PASS lint`
  - `PASS typecheck`
  - `PASS tests @zilar/server`
  - `scope: every changed file is inside the Allowed files`
  - `GATE PASS`

**Checks against the spec**
- `service.ts` has no drizzle or `db/schema` import. Verified with grep.
- The ais tests pass with no test edits.

**Open questions / deviations**
- None blocking. No existing test makes the new database writes fail (the ais/ai_limits inserts, the llm_virtual_keys insert, the status update or the compensating delete). The rollback tests fail the XMPP, LiteLLM and roster calls instead, so the new SQL in those paths is covered only by the happy path and by the rollback path running after those external failures.

## Review (written by Claude)

**2026-10-09, lead:** approved. Worker: Haiku 5.5, in one round (about 2.8 min). The lead reviewed the diff directly.
- **Result:** the same five statements with the same columns, values and order; steps 3 and 4 are still inside the provisioning `try`, so the rollback still runs. **`ais/service.ts` now has no drizzle import.** The gate passed.
- **Follow-up:** a historical comment at about line 471 mentions drizzle.

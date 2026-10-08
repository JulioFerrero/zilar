---
id: T-0681
title: "effect/sql: move the last drizzle in ais/service.ts (createAi's four statements and compensateCreate's delete) onto effect/sql; the file drops drizzle"
status: todo
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

## Review (written by Claude)

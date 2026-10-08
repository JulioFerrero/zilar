---
id: T-0652
title: "effect/sql: deleteAi's two locked transactions (:533, :561) and final row delete, plus changeAiModel's clear-model-id transaction (:1011), move to effect/sql in ais/service.ts; same locks, same order, same errors; same tests"
status: todo
milestone: M5
branch: task/T-0652-ais-delete-and-model-clear-effect-sql
model: auto
effort: low
depends_on: []
estimate: 0.5 day
---

# T-0652: ais delete and model-clear transactions on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is the second half of C3b in the T-0626 last-mile audit. T-0648 converted the first three transactions in this file. It added a private `runSql` near the top of `apps/server/src/ais/service.ts`; reuse it.

### Verified facts (do not re-derive; line numbers are from before T-0648, so find each function by name)
- **`deleteAi(deps, id, ownerId)`**, inside `withAiEnsureLock(ai.id, …)`:
  1. **Transaction 1 (old line 533):**
     - `SELECT pg_advisory_xact_lock(hashtext(${ai.id}), ${ENSURE_MODEL_LOCK_SCOPE})` (`ENSURE_MODEL_LOCK_SCOPE = 730033`);
     - select `litellm_key_id` from `llm_virtual_keys` where `ai_id`; return if there is no row or the id is null;
     - `await deps.litellm.revokeKey(id)`. On failure, `deps.logger.warn({ err, aiId }, 'could not revoke the AI virtual key')` and throw `teardownFailed()`;
     - then set `litellm_key_id = null`.
  2. **Transaction 2 (old line 561):**
     - the same lock;
     - select `litellm_model_id`. If it is non-null, `deps.litellm.deleteModel(id)`; on failure, warn `'could not delete the AI private model'` and throw `teardownFailed()`;
     - then `await deleteModelsNamed(deps, ai.id, modelNameForAi(ai.id))`, which is LiteLLM only and logs its own failures;
     - then delete the `llm_virtual_keys` row.
  3. **After the XMPP steps:** `await deps.db.delete(ais).where(eq(ais.id, ai.id))`.
- **`changeAiModel`'s recovery path (old line 1011):** inside `try { … } catch (clearError) { warn 'could not clear the AI model id' }`, a transaction that:
  - takes the same lock;
  - selects `owner` from `ais` and returns if there is no row or the owner is not `input.ownerId`;
  - sets `llm_virtual_keys.litellm_model_id = null`.
- **`teardownFailed()`** returns `new HttpError(502, 'ai_teardown_failed', …)`.
- **The recipe:**
  - `sql.withTransaction(Effect.gen(...))`, as in `apps/server/src/agents/memory/store.ts:390-410`;
  - raise an `HttpError` with `Effect.fail(...)` so `runSql`'s caller still receives that `HttpError`, as T-0648 did for `Error`;
  - wrap the LiteLLM calls in `Effect.tryPromise({ try: () => …, catch: (error) => error })`, then log and fail as today (see the `Effect.tryPromise` use in `apps/server/src/agents/reply.ts:259`).
- **Tests:**
  - `apps/server/src/ais/service.test.ts` (`deleteAi` at about lines 554 and 733);
  - `apps/server/src/ais/routes.test.ts`;
  - `apps/server/src/agents/gateway.test.ts`.

### What to build
1. **Convert the three transactions and the final `ais` delete** to effect/sql through `runSql`.
   - Keep the same lock statement, the same statement order, the same early returns, the same log lines and the same thrown errors. A failed LiteLLM call must still roll the transaction back.
   - Every failure that reaches the caller must be the same object type as today: `HttpError` for teardown, and the original error elsewhere.
2. **Leave the other drizzle code in the file as it is.** It is a later task.
3. **Change no test.**

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/ais/service.ts` (the top of the file with `runSql`, `deleteAi`, `changeAiModel`, `deleteModelsNamed`, `withAiEnsureLock`, `teardownFailed`), `apps/server/src/agents/memory/store.ts` (lines 370-420), `apps/server/src/agents/reply.ts` (lines 250-270).

### Allowed files
`apps/server/src/ais/service.ts`, `work/T-0652-ais-delete-and-model-clear-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/service src/ais/routes src/agents/gateway
pnpm gate
```

### Acceptance
- `deleteAi` and the `changeAiModel` recovery path contain no `deps.db.transaction`, `tx.` or `deps.db.delete`.
- The tests pass unchanged.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

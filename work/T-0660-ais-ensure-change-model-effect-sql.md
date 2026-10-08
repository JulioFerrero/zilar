---
id: T-0660
title: "effect/sql (C3): ensureAiModel's and changeAiModel's locked transactions in ais/service.ts, the gateway AI lookup, and connections decryptForGatewayUse move to effect/sql; connections/service.ts drops drizzle; same locks, order, errors and tests"
status: todo
milestone: M5
branch: task/T-0660-ais-ensure-change-model-effect-sql
model: auto
effort: low
depends_on: [T-0652]
estimate: 0.75 day
---

# T-0660: the AI model transactions on effect/sql

## Spec (written by Claude, do not edit)

### Why
Julio wants the whole codebase on Effect 4.0, with effect/sql replacing drizzle. This is C3 in the T-0626 last-mile audit (`docs/audit/effect-last-mile.md`). T-0648 and T-0652 converted the other `ais/service.ts` transactions and added a private `runSql`. These two are the last ones. They pass their drizzle `tx` into `findGatewayAiIn` and `decryptForGatewayUse`, so those helpers move too.

### Verified facts (find each function by name; T-0652's merge moved the lines)
**`apps/server/src/ais/service.ts`:**
- **`ensureAiModel(deps, aiId)`:**
  - reads `findAiForGateway(deps.db, aiId)` first;
  - then, inside `withAiEnsureLock(aiId, …)`, runs `deps.db.transaction`. Inside it:
    1. `SELECT pg_advisory_xact_lock(hashtext(${aiId}), ${ENSURE_MODEL_LOCK_SCOPE})`;
    2. `findGatewayAiIn(txDb, aiId)`, throwing `new Error(`AI ${aiId} not found`)` if there is no row, and returning early if `litellmModelId !== null`;
    3. throw `new Error(`AI ${aiId} has no virtual key`)` if `litellmKeyId === null`;
    4. `await deleteModelsNamed(...)`;
    5. `decryptForGatewayUse(txDb, deps.cipher, ai.providerConnectionId)`;
    6. `registerModelWithKey(...)`;
    7. update `llm_virtual_keys.litellm_model_id`.
  - The comment explains: "the unit-test database shares a single connection, so every read inside the lock must ride `tx`".
- **`changeAiModel(deps, input)`'s main transaction:**
  - the lock, then `findGatewayAiIn(txDb, ai.id)`: no row, or a different owner, means `HttpError(404)`;
  - an early return when nothing changed;
  - `updateFailed()` when there is no key;
  - `decryptForGatewayUse(txDb, …)`, then `deps.litellm.deleteModel(old)` if there is one, then `deletedOld = true`;
  - `deleteModelsNamed`, `registerModelWithKey`, then update `ais` (`model`, `provider_connection_id`, `updated_at`) and `llm_virtual_keys.litellm_model_id`.
  - The surrounding `catch` re-throws an `HttpError`. Any other error is logged with `'could not switch the AI model'` and, if `deletedOld`, runs the recovery transaction (already on effect/sql since T-0652).
- **The lookups:**
  - `findGatewayAiIn(txDb, aiId)` and `findAiForGateway(db, aiId)` run the same drizzle query: `aiColumns` (the `publicAiColumns`, plus `localpart`, `litellmKeyId` and `litellmModelId`, defined near the end of the file), plus `provider` and `owner`;
  - its joins are `ais ⋈ ai_limits ⟕ llm_virtual_keys ⋈ provider_connections`, `WHERE ais.id = ?`;
  - both return the `GatewayAiRecord` type.

**`apps/server/src/connections/service.ts`** (174 lines):
- `decryptForGatewayUse(db, cipher, connectionId)` (line 160) is its only drizzle query (imports at lines 1 and 6). It selects `encrypted_key`, throws `new Error('Connection not found')` if there is no row, and returns `cipher.decrypt(...)`.
- Everything else already uses its private `runSql` (line 40).
- Callers: `ais/service.ts` in `createAi` (outside any transaction) and the two transactions above.

**The recipe:**
- `sql.withTransaction(Effect.gen(...))`; statements inside it ride the transaction's connection.
- Raise errors with `Effect.fail(...)` so the caller receives the same object: an `HttpError` stays an `HttpError`, an `Error` stays that `Error`.
- Wrap LiteLLM calls in `Effect.tryPromise({ try, catch: (error) => error })`, so a LiteLLM failure reaches the `changeAiModel` catch unchanged. The T-0652 code in `deleteAi` is the local example.

### What to build
1. **`connections/service.ts`:**
   - add `export function decryptForGatewayUseEffect(cipher, connectionId)`, an `Effect` that needs `SqlClient` and fails with the same `Error`;
   - `decryptForGatewayUse(db, cipher, id)` becomes `runSql(db, decryptForGatewayUseEffect(cipher, id))`; widen `runSql`'s error type if needed;
   - drop the drizzle and schema value imports.
2. **`ais/service.ts`:**
   - replace `findGatewayAiIn` with `findGatewayAiEffect(aiId)`, one effect/sql `SELECT` with the same columns and joins. Alias any column whose camelCase name would collide (for example the two `ai_id`s), so the row matches `GatewayAiRecord` exactly; numeric limits stay strings, as drizzle gave them.
   - `findAiForGateway(db, aiId)` becomes `runSql(db, findGatewayAiEffect(aiId))`.
   - Convert both transactions to `runSql(deps.db, … sql.withTransaction(…))`, with the same lock, the same order, the same early returns and the same errors.
   - `deletedOld` keeps its meaning: it is set right after the old model's delete.
3. **Keep all signatures and change no test.**

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `apps/server/src/ais/service.ts` (all of `createAi`, `deleteAi`, `findAiForGateway`, `findGatewayAiIn`, `ensureAiModel`, `changeAiModel`, `registerModelWithKey`, `deleteModelsNamed`, `withAiEnsureLock`, and the column constants near the end), `apps/server/src/connections/service.ts`.

### Allowed files
`apps/server/src/ais/service.ts`, `apps/server/src/connections/service.ts`, `work/T-0660-ais-ensure-change-model-effect-sql.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/service src/ais/routes src/connections src/agents/gateway
pnpm gate
```

### Acceptance
- `ais/service.ts` has no `.transaction(` and no `findGatewayAiIn`.
- `connections/service.ts` has no `drizzle-orm` import.
- The tests pass unchanged, including the `ensureAiModel` concurrency tests.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

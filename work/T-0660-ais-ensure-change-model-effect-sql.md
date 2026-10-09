---
id: T-0660
title: "effect/sql (C3): ensureAiModel's and changeAiModel's locked transactions in ais/service.ts, the gateway AI lookup, and connections decryptForGatewayUse move to effect/sql; connections/service.ts drops drizzle; same locks, order, errors and tests"
status: merged
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

Status: done. Both `ais/service.ts` transactions and the gateway lookups now run
on `effect/sql`; `connections/service.ts` no longer imports drizzle.

### What I did

**`apps/server/src/connections/service.ts`**
- Dropped the `drizzle-orm` and `../db/schema` imports.
- Added `decryptForGatewayUseEffect(cipher, connectionId)`: a `SqlClient` effect
  that `SELECT`s `encrypted_key FROM provider_connections WHERE id = ?`, fails
  with the same `new Error('Connection not found')` on no row, and returns
  `cipher.decrypt(...)`.
- `decryptForGatewayUse(db, cipher, id)` is now `runSql(db, decryptForGatewayUseEffect(...))`;
  widened `runSql` to `runSql<A, E>` with `SqlError.SqlError | E`.
- Rewrote the stale "stays on drizzle" comment.

**`apps/server/src/ais/service.ts`**
- Imported `decryptForGatewayUseEffect` and dropped the now-unused
  `providerConnections` schema import (and the now-unused drizzle `sql` import).
- Replaced `findGatewayAiIn(txDb, aiId)` with `findGatewayAiEffect(aiId)`: one
  `effect/sql` `SELECT` with the same columns and joins
  (`ais ⋈ ai_limits ⟕ llm_virtual_keys ⋈ provider_connections`, `WHERE ais.id = ?`).
  Columns are listed explicitly; `transformResultNames` camelCases them into
  `GatewayAiRecord` (`per_day_usd`→`perDayUsd`, `provider_connection_id`→
  `providerConnectionId`, …). No unaliased `ai_id` is selected from the two
  tables that both carry one.
- `findAiForGateway(db, aiId)` is now `runSql(db, findGatewayAiEffect(aiId))`.
- `ensureAiModel`: the body under `withAiEnsureLock` is now
  `runSql(deps.db, sql.withTransaction(…))`. Same advisory lock, same
  re-read-after-lock, same early returns, same errors (`AI <id> not found`,
  `AI <id> has no virtual key` via `Effect.fail`). `decryptForGatewayUseEffect`
  and the LiteLLM calls (wrapped in `Effect.tryPromise({ catch: (error) => error })`)
  ride the transaction. Final `UPDATE llm_virtual_keys SET litellm_model_id = ?`
  is raw SQL.
- `changeAiModel`: the main transaction is `runSql(deps.db, sql.withTransaction(…))`
  with the same lock, the same `findGatewayAiEffect` re-read, the same 404 when
  the row is missing/foreign, the same no-op early return, the same
  `HttpError`/`updateFailed()` failures (`Effect.fail` so the `catch` receives
  the same object), the same `decryptForGatewayUseEffect`, then the optional
  `deleteModel(old)` and `deletedOld = true` immediately after it, then
  `deleteModelsNamed`, `registerModelWithKey`, and the two raw-SQL updates. The
  `catch` (log, `deletedOld` recovery transaction, `throw updateFailed()`) is
  unchanged.
- All exported signatures unchanged; no test changed.

### Files changed (all inside Allowed files)
- `apps/server/src/ais/service.ts`
- `apps/server/src/connections/service.ts`
- `work/T-0660-ais-ensure-change-model-effect-sql.md`

### Commands and real results
- `pnpm install` — done, 1173 packages, one unrelated peer warning
  (`@types/react` for mobile), no errors.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/service src/ais/routes src/connections src/agents/gateway`
  — `Test Files 6 passed | 1 skipped (7)`, `Tests 274 passed | 1 skipped (275)`,
  44.31s. This is the task's Checks command.
- `pnpm gate` — first run: FAIL on `format` (`apps/server/src/ais/service.ts`
  prettier style, the wrapped import). Fixed only that file with
  `pnpm exec prettier --write apps/server/src/ais/service.ts`. Second run:
  ```
  PASS  install (frozen)  (1.3s)
  PASS  format  (21.1s)
  PASS  lint  (1.7s)
  PASS  typecheck  (13.2s)
  PASS  tests @zilar/server  (15.9s)
  scope: every changed file is inside the Allowed files
  GATE PASS
  ```

### Acceptance
- `ais/service.ts` has no `.transaction(` and no `findGatewayAiIn` (grep: no
  matches).
- `connections/service.ts` has no `drizzle` import or reference (grep count: 0).
- All tests pass unchanged, including the `ensureAiModel` concurrency tests.
- `pnpm gate` ends with `GATE PASS` and lists no file outside the Allowed files.

### Problems / deviations
- None. One pre-gate formatting fix (see above); no test or spec change.

### Open questions
- None.

## Review (written by Claude)

**2026-10-09, lead:** approved.
- **Pre-review:** clean after the lead fix round; the packet head is f7e6c87f, the current HEAD. The decrypt now fails with the original error, and the lock comment is fixed.
- **Result:** `ais/service.ts` has no `.transaction(` left, and `connections/service.ts` has no drizzle left.
- **Nits I accepted, for the follow-ups:** the module header at `ais/service.ts:23-26` understates the migration, and the `decryptForGatewayUseEffect` error channel is `unknown` (it could be `SqlError | Error`).

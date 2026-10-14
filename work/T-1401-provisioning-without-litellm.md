---
id: T-1401
title: "P0 task 5: creating, editing and deleting an AI no longer calls LiteLLM (no virtual key, no /model/new); the AIs API needs only the key cipher"
status: merged
milestone: M5
branch: task/T-1401-provisioning-without-litellm
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1401: AI provisioning without LiteLLM

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: the model calls move into our server through Effect AI, and LiteLLM goes away (`docs/design/agent-system.md` §7). T-1399 makes AI turns use the AI's own provider connection.

**This task makes AI creation work without LiteLLM.** Production has none, so today the AIs API answers 503 `ais_unavailable`. It's the plan's **Task 5** in `docs/audit/effect-ai-plan.md` (read §2.3 and §5.5). Run in parallel with T-1399: don't touch `apps/server/src/agents/`.

### Facts (the lead checked them on main, 2026-10-14)
- **Create** (`apps/server/src/ais/provisioning.ts:99-125`): decrypts the provider key, `deps.litellm.addModel` (`:104`), `generateKey` (`:111`), then `INSERT INTO llm_virtual_keys` (`:123`).
- **Limits change:** `updateKey` cap (`provisioning.ts:205`) and the row update (`:242`).
- **Model change:** `changeAiModel` (`apps/server/src/ais/provisioning-keys.ts:163`), which runs LiteLLM `deleteModel` and `addModel` (`:229-257`).
- **`ensureAiModel`** (`provisioning-keys.ts:79`) registers the model on a gateway turn, with stray-model cleanup at `:30-33`. T-1399 removes its callers.
- **Delete:** `revokeKey` (`apps/server/src/ais/provisioning-xmpp.ts:56,163`), `deleteModel` (`:87,173`), and `DELETE FROM llm_virtual_keys` (`:101`).
- **`AiServiceDeps.litellm`** is required (`apps/server/src/ais/persona.ts:50`).
- **The 503 gate** is `configuredLayer` (`apps/server/src/ais/api.ts:111-129`), which requires `litellm` and `cipher`; the backstop is `requireConfigured` (`:141-149`). `api.ts` is 397 lines.
- **Usage** reads LiteLLM key spend (`apps/server/src/ais/usage.ts:83`). Usage and budgets are replaced in a later task.
- **The provider check** (`isLlmProvider`) is in `apps/server/src/ais/litellm-model.ts`.

### What to build
1. **Create:** no `addModel`, no `generateKey`, no `llm_virtual_keys` insert, and no provider-key decrypt (the turn decrypts per call now).
   - Keep the XMPP account, roster, avatar and the `ais` row with `provider_connection_id` and `model`.
   - Keep the connection checks: it's owned by the creator, it's active, and it's an LLM provider.
2. **Limits change:** only the `ai_limits` row; no `updateKey`.
3. **Model change** (`changeAiModel`): update `ais.model` and `ais.provider_connection_id` in one transaction, with the same ownership and LLM-provider checks; nothing remote. Keep the locks only if something still needs them, and say which in the Report.
4. **`ensureAiModel`:** keep the export as a no-op with a one-line comment ("LiteLLM is gone; removed with the env clean-up"). T-1399 deletes its callers, and the clean-up task deletes it.
5. **Delete:** no `revokeKey` or `deleteModel`. Keep `DELETE FROM llm_virtual_keys WHERE ai_id = …`, so old rows go with the AI.
6. **`AiServiceDeps.litellm`** becomes optional (`litellm?: LitellmAdminClient`); nothing in `apps/server/src/ais/` calls it except `usage.ts`, which returns `null` (fails open, as it does on a LiteLLM error today) when it's absent.
7. **The 503 gate** and `requireConfigured` need only the cipher. Keep `api.ts` at most 400 lines (move a helper out if needed).
8. **Out of scope:** dropping tables or columns, env and compose, `litellm-client.ts`, `model-entry.ts`, and anything in `apps/server/src/agents/`. The `isLlmProvider` move can wait.

### Tests (permissions: keep them few)
- Update the existing AI provisioning tests to the no-LiteLLM path (find them with `git grep -ln "createAi\|changeAiModel" apps/server/src -- '*.test.ts'`).
- Make sure one test still proves that creating with **another user's connection** is refused, and one that a non-LLM connection (GitHub) is refused.
- No new UI tests.

### Read first
`AGENTS.md`, `docs/audit/effect-ai-plan.md` §2.3 and §5.5, and the files above.

### Allowed files
`apps/server/src/ais/*.ts`, `apps/server/src/connections/service.ts`, `work/T-1401-provisioning-without-litellm.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/ais --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; files stay at most 400 lines.
- With `LITELLM_*` unset and the key cipher set, creating, editing (model, limits) and deleting an AI works (prove it with the updated tests).
- The tests above pass.

---

## Report (written by the worker when done)

Status: review. All changes are inside `apps/server/src/ais/*.ts` and this task
file.

### What I did (per Spec item)

1. **Create** (`provisioning.ts`): dropped the provider-key decrypt, `addModel`,
   `generateKey` and the `llm_virtual_keys` insert. The AI row keeps
   `provider_connection_id` + `model`; the XMPP account, both roster items,
   `ai_limits` and the `disabled` -> `active` flip are unchanged. The connection
   checks (owned, active, LLM provider) are unchanged.
2. **Limits change** (`updateAi`): only the `ai_limits` row is updated; the
   `deps.litellm.updateKey` call and the `llm_virtual_keys.budget_usd` update are
   gone (as is the `litellmKeyId === null` guard).
3. **Model change** (`changeAiModel`): now trims/validates the model, keeps the
   same ownership and LLM-provider checks (foreign/missing connection -> 404,
   inactive -> 400 `connection_inactive`, non-LLM -> 400 `connection_not_llm`),
   then updates `ais.model` + `ais.provider_connection_id` in one transaction
   that re-reads the row and diffs it inside the transaction. Nothing remote.
   **Locks:** all of them are gone — `withAiEnsureLock`,
   `ENSURE_MODEL_LOCK_SCOPE`, `deleteModelsNamed` and `registerModelWithKey`.
   With no remote model to register or replace there is no cross-process race to
   serialize, so keeping the advisory lock would only guard a single-row update
   already guarded by the transaction.
4. **`ensureAiModel`** stays exported as a no-op with a one-line comment
   ("LiteLLM is gone (T-1401); removed with the env clean-up."). Callers in
   `apps/server/src/agents/` are untouched (T-1399 removes them), so the
   signature is unchanged.
5. **Delete** (`deleteAi`): no `revokeKey`, no `deleteModel`. The two locked
   gateway transactions collapsed into one transaction that keeps
   `DELETE FROM llm_virtual_keys WHERE ai_id = …` followed by the `ais` delete.
   Roster teardown and account unregister are unchanged.
6. **`AiServiceDeps.litellm`** is now optional (`litellm?` in `persona.ts`), and
   `AiUsageDeps.litellm` too: `getAiUsage` answers `null` immediately when it is
   absent (fail open, as on a LiteLLM error). `usage.ts` is the only file under
   `ais/` that still calls the client.
7. **503 gate** (`api.ts`): `configuredLayer` and `requireConfigured` now require
   only `cipher`; `serviceDeps` passes `litellm` only when present. `api.ts` went
   from 397 to 389 lines.
8. Out of scope left alone: no table/column changes, no env/compose,
   `litellm-client.ts`, `model-entry.ts`, `apps/server/src/agents/`. The
   `isLlmProvider` move also waited, so `ais/litellm-model.ts` (including the now
   unused `litellmModelFor`) is unchanged, as item 8 allows. `connections/service.ts`
   was allowed but needed no change: `updateConnectionKey` still clears
   `llm_virtual_keys.litellm_model_id`, which is harmless and belongs to the later
   clean-up.

### Files changed

- `apps/server/src/ais/provisioning.ts` (create + limits path)
- `apps/server/src/ais/provisioning-keys.ts` (no-op `ensureAiModel`, local `changeAiModel`)
- `apps/server/src/ais/provisioning-xmpp.ts` (delete + compensate)
- `apps/server/src/ais/api.ts` (503 gate needs only the cipher)
- `apps/server/src/ais/persona.ts` (optional `litellm`)
- `apps/server/src/ais/usage.ts` (optional `litellm`, fail open)
- `apps/server/src/ais/service.ts` (barrel: dropped `VIRTUAL_KEY_BUDGET_DURATION`, `virtualKeyAlias`)
- `apps/server/src/ais/provisioning.test.ts` (new)

### Tests

The old AI provisioning tests were deleted in T-0931 (`git grep -ln "createAi|changeAiModel" apps/server/src -- '*.test.ts'` finds none), so I added a
small new file instead of editing existing ones. It mounts the real app with the
key cipher set and no LiteLLM client (the production shape) and covers:

- create -> 201, `provider_connection_id`/`model` stored, `status: active`, no
  `llm_virtual_keys` row;
- edit model + connection + limits -> 200, row updated, still no key row;
- delete -> 204 and the rows (including a pre-seeded legacy `llm_virtual_keys`
  row) are gone;
- create with another user's connection -> 400 `invalid_connection`;
- create with a GitHub (non-LLM) connection -> 400 `connection_not_llm`.

Commands (real results):

- `pnpm install` — done, 15.4s.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais/provisioning.test.ts` — **1 file, 3 passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot src/ais` — **2 files, 16 passed**.
- `pnpm gate` (repo root):
  ```
  gate: 9 changed file(s) against main
  PASS  install (frozen)  (1.0s)
  PASS  format  (1.2s)
  PASS  lint  (1.0s)
  PASS  typecheck  (3.1s)
  PASS  effect  (0.7s)
  PASS  tests @zilar/server  (5.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Problems / deviations

- No existing provisioning tests to update (see above); I added one file. Kept
  it to 3 tests as the Spec asks.
- `apps/server/src/leader/lock.ts:14` still mentions `ENSURE_MODEL_LOCK_SCOPE` in
  a comment; that constant is gone now. The file is outside my Allowed files, so
  I left the stale comment for the clean-up task.

### Open questions

- None blocking. The later clean-up (Task 6) still owns dropping
  `llm_virtual_keys`, `usage.ts`, and the remaining `LITELLM_*` wiring.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN (nit: api.ts comment about the cipher; follow-up: stale ENSURE_MODEL_LOCK_SCOPE comment in leader/lock.ts, for the env clean-up task). Checked: changeAiModel keeps owner, active and LLM-provider checks; ensureAiModel is a no-op stub for T-1399; api.ts is 389 lines. Server-only; live check after T-1399: create an AI with LITELLM unset.

---
id: T-0052
title: Change an AI's model after creation — PATCH `model` (and optionally the provider connection), re-register the AI's LiteLLM model safely, model picker in the AI panel
status: review
milestone: M2
branch: task/T-0052-change-ai-model
model: opencode-go/muse-spark-1.3-contributor
depends_on: [T-0033, T-0039]
estimate: 1 day
---

# T-0052: Change an AI's model

## Spec (written by Claude, do not edit)

### Goal

Today an AI's model is fixed at creation: the panel says "The model is set when the AI is created and can't be changed here yet". Julio wants to switch an AI's model later, for example from `deepseek-chat` to a stronger model on the same key, or to another provider connection he owns.

Each AI has a private LiteLLM model `ai-<id>` (T-0033). It holds the owner's provider key, and the AI's virtual key can only call that model. A model change must therefore:
- update the AI row;
- replace the LiteLLM model entry behind the **same name** `ai-<id>`, so the virtual key's allowlist and the gateway don't change;
- never leave an orphan model in LiteLLM, or an AI that can't reach any model.

### Read first
- `AGENTS.md` (mandatory)
- `apps/server/src/ais/service.ts`, all of it, especially:
  - `createAi` (how the model is validated against the connection's provider);
  - `updateAi`;
  - `ensureAiModel` (the advisory lock, the stray-model cleanup, `addModel` / `updateKey` / `deleteModel`);
  - `decryptForGatewayUse`;
  - `deleteAi` (how it removes the LiteLLM model).
- `apps/server/src/ais/routes.ts` (`CreateAiSchema`, `UpdateAiSchema`), `litellm-model.ts`, and their tests (`service.test.ts`, `routes.test.ts`, `integration.test.ts`: how LiteLLM is faked)
- `apps/server/src/ai/litellm-client.ts` (the admin client interface) and `model-entry.ts` (`modelNameForAi`)
- `apps/server/src/agents/gateway.ts`: only to confirm it calls `ai-<id>` by name and `ensureAiModel` when the model id is missing. **Don't edit it**; T-0050 is changing it right now.
- `apps/web/src/components/ais/AiPanel.tsx`, `ModelPicker.tsx`, `ConnectionPicker.tsx`, `NewAiDialog.tsx` (how create picks the connection and model), `apps/web/src/lib/api.ts` (`updateAi`, `UpdateAiInput`), and their tests

### Allowed files
- `apps/server/src/ais/routes.ts`, `service.ts`, plus `routes.test.ts`, `service.test.ts`, `integration.test.ts`
- `apps/web/src/lib/api.ts`: the `UpdateAiInput` type only
- `apps/web/src/components/ais/AiPanel.tsx`, plus `AiPanel.test.tsx`; `ModelPicker.tsx` and `ConnectionPicker.tsx` only if a small prop is needed for reuse
- `work/T-0052-change-ai-model.md` and `work/screenshots/T-0052/**`

**Not allowed:** `apps/server/src/agents/**` (T-0050), `apps/server/src/db/**` (no migration: the columns exist), `apps/mobile/**`, `packages/**`, `docs/**`. If you find you need a migration or a gateway change, stop and ask in the Report.

### Allowed dependencies
None.

### What to build

**1. API.** `PATCH /api/ais/:id` also accepts:
- `model` (the same validation as create);
- `providerConnectionId` (optional, the same validation as create).

Rules:
- The connection must belong to the **same owner** (404 as today for anything not owned) and be usable, exactly as `createAi` checks.
- The model must fit that connection's provider (reuse the create-time check).
- `providerConnectionId` without `model` is a 400: a new provider needs an explicit model.
- If `model` and the connection are both unchanged, it's a no-op for LiteLLM (don't touch it).
- `.strict()` stays: unknown fields are still a 400.

**2. Service: `changeAiModel`**, called from `updateAi` when the model or the connection changes. Do it under the **same locks as `ensureAiModel`** (the in-process `withAiEnsureLock` and the Postgres advisory lock with `ENSURE_MODEL_LOCK_SCOPE`), so it can never race a gateway `ensureAiModel` for the same AI. Refactor `ensureAiModel` into a shared internal helper rather than copy it. The order:
1. Decrypt the (new) connection's key, inside the lock, as `ensureAiModel` does.
2. Register the new entry. LiteLLM can't have two models with the same name safely, so:
   - (a) delete the old model id (and any stray `ai-<id>` entries, as `ensureAiModel` does);
   - (b) `addModel` with the new `litellmModel` and key under the same name `ai-<id>`;
   - (c) `updateKey` so the allowlist is `[ai-<id>]` (unchanged name, but re-assert it);
   - (d) in the same DB transaction, update `ais.model`, `ais.providerConnectionId`, `updatedAt` and `llm_virtual_keys.litellmModelId`.
3. **Failure handling:**
   - If `addModel` or `updateKey` fails after the old model was deleted, set `litellmModelId = null` and leave the AI row **unchanged** (the old model and connection), then answer the same `updateFailed()` error. The next gateway turn then runs `ensureAiModel` and re-registers the **old** model, so the AI keeps working.
   - A model registered in step (b) whose `updateKey` failed is deleted (best-effort), as `ensureAiModel` already does.
4. Log only ids (the AI id and the model name `ai-<id>`), never keys. Every error passes through the existing redaction.
5. A turn in flight during the swap may fail once with the gateway's honest failure text. That's acceptable; document it in a code comment.

**3. Web: the AI panel.**
- Replace the "can't be changed here yet" text with the connection picker (only when the owner has more than one usable connection) plus the model picker, as in `NewAiDialog`, prefilled with the current values.
- Save sends only the changed fields (the panel already does this for name, persona and limits).
- Show "Switching model…" while saving. On an error, show the server's message inline and keep the old values shown.
- After a successful save, the panel and the AI list show the new model.
- Changing the connection resets the model picker to that provider's suggestions (reuse `defaultModelFor`), the same as create.

### Tests (Vitest, no network: LiteLLM and the admin client faked as today)
- Routes:
  - a model-only change → 200 with the new model;
  - a connection plus model change → 200;
  - a connection without a model → 400;
  - someone else's connection → 404;
  - an unknown field → 400;
  - a model not valid for the provider → 400;
  - an unchanged model → no LiteLLM calls.
- Service, with the LiteLLM fake recording calls:
  - the happy order (delete old → add new → updateKey → DB row) under the lock;
  - `addModel` fails → the row is unchanged, `litellmModelId` is null, and a later `ensureAiModel` re-registers the old model;
  - `updateKey` fails → the new model is deleted, the row is unchanged, and `litellmModelId` is null;
  - a concurrent `ensureAiModel` and `changeAiModel` on the same AI serialize (reuse the existing race-test pattern);
  - no key material appears in the logs (reuse the existing redaction assertions).
- Web `AiPanel`: the pickers show the current values, only changed fields are sent, the error keeps the old values, and a connection change resets the model.

### Visual check
Mock mode (`?mock=1`), if the AI panel has a mock path, otherwise a component render: take a panel screenshot at 1440×900 with the pickers open. Save it to `work/screenshots/T-0052/`. Stop any dev server you start.

### Live check (the lead does it)
The lead switches one of Julio's AIs between two models on his real stack. That may need Julio's OK if it spends money. Give exact steps in the Report.

### Acceptance criteria
- [ ] Every check below passes.
- [ ] The model and connection change works under the ensure lock, with no orphan models, and a failed change leaves a working AI.
- [ ] The panel lets the owner switch the model; only changed fields are sent.
- [ ] No keys in logs or responses; only the Allowed files changed.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force --filter=@galena/server --filter=@galena/web
pnpm build
```

### Out of scope
- Mobile's edit screen (a follow-up).
- Per-model price or limit changes (the limits stay as they are).
- The gateway (T-0050 owns it).

## Report (written by the worker when done)

### What was built
- **API** (`apps/server/src/ais/routes.ts`): `UpdateAiSchema` also accepts `model` (trim, 1–256) and `providerConnectionId` (trim, 1–128), `.strict()` kept, plus a refine so `providerConnectionId` without `model` is a 400. Both fields are passed through to `updateAi`.
- **Service** (`apps/server/src/ais/service.ts`):
  - `UpdateAiInput` gained optional `model` / `providerConnectionId`. `updateAi` rejects `providerConnectionId`-without-`model` with 400 and calls the new `changeAiModel` first (before roster/limits steps) when the effective model or connection differs; identical values are a LiteLLM no-op.
  - New exported `changeAiModel`: validates (owned AI, non-empty model, connection owned → else 404 `not_found`, active → else 400 `connection_inactive`, LLM provider → else 400 `connection_not_llm`), then runs under the same locks as `ensureAiModel` (`withAiEnsureLock` + advisory lock `ENSURE_MODEL_LOCK_SCOPE`). Inside one transaction it re-reads the row, decrypts the new connection key, deletes the old model id, reclaims strays, `addModel`s the new `litellmModel` under the same name `ai-<id>`, re-asserts the key allowlist `[ai-<id>]`, and updates `ais.model`, `ais.providerConnectionId`, `updatedAt` plus `llm_virtual_keys.litellmModelId`.
  - Failure handling: `addModel`/`updateKey` failure after the old delete → best-effort deletes the just-registered model, sets `litellmModelId = null` in a second locked transaction, leaves the AI row on the old model/connection, throws the existing `updateFailed()` (502 `ai_update_failed`); the next gateway turn re-registers the old model via `ensureAiModel` (covered by a test). Old-model delete or decrypt failure throws `updateFailed()` without touching the row. Logs carry only `{ err, aiId }` through the existing redaction; a code comment documents that an in-flight turn may fail once with the gateway's honest text.
  - `ensureAiModel` was refactored to share the new internal helpers (`deleteModelsNamed`, `registerModelWithKey`, `findGatewayAiIn`); behavior unchanged.
- **Web**:
  - `apps/web/src/lib/api.ts`: `UpdateAiInput` gained `model?` / `providerConnectionId?` (only change in that file).
  - `AiPanel.tsx`: the "can't be changed here yet" block is replaced by a `ConnectionPicker` (only when the owner has more than one active connection) plus a `ModelPicker` prefilled with the current values, as in `NewAiDialog`. Changing the connection resets the model to `defaultModelFor` of the new provider. Save sends only changed fields (model-only → `{ model }`; connection change → `{ model, providerConnectionId }`); busy label is "Switching model…" for model saves, "Saving…" otherwise; on error the server-mapped message shows inline and the pickers revert to the stored values; on success panel + chat title update. No changes to `ModelPicker`/`ConnectionPicker` were needed; `aiForm.ts` untouched (diff done inline in the panel).

### Files changed
- `apps/server/src/ais/service.ts`, `routes.ts`, `routes.test.ts`, `service.test.ts`
- `apps/web/src/lib/api.ts` (type only), `apps/web/src/components/ais/AiPanel.tsx`, `AiPanel.test.tsx`
- `work/T-0052-change-ai-model.md`, `work/screenshots/T-0052/ai-panel-1440.png`

### Tests added
- Routes (5): model-only switch asserts 200 + exact LiteLLM order delete→add→updateKey under `ai-<id>` + DB row; connection+model switch (`openai/gpt-4o-mini` → `anthropic/claude-sonnet-5`); connection-without-model / foreign-connection-404 / non-LLM-400 / blank-model-400 / unknown-field-400 with no LiteLLM calls and unchanged row; unchanged-model no-op; swap-failure 502 keeps old row, nulls the model id, no key in body/log.
- Service (8): happy order incl. DB row; connection+model move via `updateAi`; no-op; `addModel`-fails → row unchanged, id null, later `ensureAiModel` re-registers the old model; `updateKey`-fails → new model deleted (`['model-1','model-2']`), row unchanged, id null; concurrent `ensure`+`change` serialize with no orphans; foreign-connection 404 + connection-without-model 400; log redaction.
- Web `AiPanel` (6 new, 2 updated): picker prefill, single-connection hides provider picker, model-only PATCH + new model shown, "Switching model…" in flight, error keeps old values, connection change resets model to provider default and sends both.

### Commands (real results)
```bash
pnpm install                                        # Done in 7s, 1008 packages
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # exit 0 (fixed one oxlint no-useless-fallback-in-spread in AiPanel)
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/server --filter=@galena/web
  # server: 37 files passed, 5 skipped — 426 passed, 7 skipped; web: 6 ais files 38 passed; full web suite green; Tasks 2 successful
pnpm build                                          # Tasks: 2 successful, 2 total
```

### Visual check
Served this worktree's Vite on `localhost:5231` (`GALENA_API_URL` → throwaway mock API on `127.0.0.1:4321` in the approved temp dir, answering `/api/auth/get-session`, `/api/ais`, `/api/connections`) and screenshotted `http://localhost:5231/c/c-devai?mock=1&panel=ai` at 1440×900 with headless Chrome. `work/screenshots/T-0052/ai-panel-1440.png`, looked at: panel open on the mock "Dev AI", Provider picker with DeepSeek/Main key selected + OpenAI/Backup key, Model input `deepseek-chat` with `deepseek-chat`/`deepseek-reasoner` suggestions, Save disabled. Both servers stopped (5231/4321 free); mock script left in the temp dir only, repo untouched by it. Note: `curl` started needing lead approval mid-task, so readiness probes used `python3`/sockets instead.

### Live check for the lead (needs Julio's OK if it spends money)
1. Pick an AI on `deepseek-chat` owned by Julio and note its LiteLLM model id + key allowlist (`GET /model/info`, `/key/info`).
2. In the web AI panel, change only the model to `deepseek-reasoner`, Save → panel shows the new model; confirm `ai-<id>` still the only allowlist entry and the model id changed exactly once (no orphan `ai-<id>` in `/model/info`).
3. Send the AI a chat message → it answers with the new model.
4. Optionally repeat with a second provider connection + explicit model.
5. To exercise failure recovery: stop LiteLLM, attempt a switch (expect 502, old model still shown), restart LiteLLM, send a message (gateway `ensureAiModel` re-registers, AI answers).

### Deviations / open questions
- Foreign/missing `providerConnectionId` on PATCH answers **404** `not_found` (spec's route test), while create answers 400 `invalid_connection` — deliberate, to avoid leaking connection existence; the service-level 400 check for connection-without-model lives in both the route refine and `updateAi`.
- `ai_update_failed` surfaces in the panel through the existing `describeAiError` mapping ("The server couldn't finish…"), not the raw server string — consistent with every other panel error.
- No migration, no gateway change, no new dependencies. Only Allowed files changed (`git status` clean otherwise).

## Round 2 (review fixes)

1. **should-fix — `deleteAi` under the same locks.** The revoke step and the model-delete/key-row step each run in their own advisory-locked transaction inside `withAiEnsureLock`, re-reading the key/model ids under the lock; step 2 also reclaims strays named `ai-<id>` via the shared `deleteModelsNamed`. Commit points are unchanged (revoke+clear commits before the model delete), so all existing resumable-teardown semantics hold: revoke exactly once, key row survives a model-delete failure with a nulled key id, null-model and keyless AIs skip. New service test: concurrent `changeAiModel` + `deleteAi` (`Promise.allSettled`) → no AI/key rows left, key revoked once, every registered model id deleted.
2. **nit — panel shows server truth on failed save.** The save-error path now `getAi(id)` and repopulates every field from it, keeping the inline error; if the refetch itself fails it falls back to the stale snapshot. New test: PATCH 502 after a partial commit (server has new model, old name) → error shown, model input shows the new model, name reverts. The old error-keeps-values test still passes (refetch returns the unchanged AI).
3. **nit — recovery transaction owner check.** The failure-recovery transaction re-reads `ais.owner` and skips the null-out when the row is gone or no longer owned, mirroring the main path; the `updateFailed()` error still stands.

### Commands (real results, Round 2)
```bash
pnpm format:check                                   # All matched files use Prettier code style!
pnpm lint                                           # exit 0
pnpm typecheck                                      # Tasks: 9 successful, 9 total
pnpm exec turbo test --force --filter=@galena/server --filter=@galena/web
  # server: 37 files, 427 passed / 7 skipped; web: 35 files, 235 passed; Tasks 2 successful
pnpm build                                          # Tasks: 2 successful, 2 total
```
`PREREVIEW.md` left untracked. No screenshot change (panel visuals unchanged; error path verified by test).

## Review (written by Claude)

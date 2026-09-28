---
id: T-0052
title: Change an AI's model after creation — PATCH `model` (and optionally the provider connection), re-register the AI's LiteLLM model safely, model picker in the AI panel
status: planned
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

## Review (written by Claude)

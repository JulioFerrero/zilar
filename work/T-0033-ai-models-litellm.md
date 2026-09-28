---
id: T-0033
title: Register each AI's private model in LiteLLM (owner's key stays in the gateway) + list AIs in /api/chats
status: todo
milestone: M2
branch: task/T-0033-ai-models-litellm
model: opencode-go/deepseek-v4.1-flash
depends_on: [T-0030, T-0032]
estimate: 2 days
---

# T-0033: AI models in LiteLLM, and AIs in the chat list

## Spec (written by Claude, do not edit)

### Goal

AIs exist now: T-0030 built the server side and T-0032 the web wizard. Each has an XMPP account and a capped LiteLLM virtual key. Two things still stop an AI from replying (the reply loop itself is T-0034):

1. **Its virtual key can't reach a model.** T-0030 issues the key with `models: [<the model name the owner typed>]`, e.g. `gpt-4o-mini`. LiteLLM has no such model, and nothing there knows the owner's provider key.
2. **Its chat can't be opened.** `/api/chats` lists human contacts and groups only. "Open chat" on My AIs therefore lands on "Select a chat". The lead saw this live during the T-0032 review.

**Julio decided (2026-09-28)** how the owner's key reaches the provider, following `docs/PROJECT_PLAN.md` §8.3 ("Decryption happens only inside the LLM gateway"):
- When an AI gets a model, the server decrypts the owner's connection key **once**, in memory.
- It registers a **private LiteLLM model** for that AI, e.g. `ai-<aiId>` pointing to `openai/gpt-4o-mini` with that `api_key`.
- The AI's virtual key may call **only** that model.
- The provider key is never stored anywhere else, and never returned, logged or put in an error.

LiteLLM keeps its own encrypted copy (`store_model_in_db`, encrypted with `LITELLM_SALT_KEY`). That's the accepted trade-off.

### Read first
- `AGENTS.md` (mandatory)
- `docs/PROJECT_PLAN.md` §8.3 and §8.4
- `work/T-0007-litellm-virtual-keys.md`: the Report sections "BYOK specifics" and "What the M2 gateway task has to do". This covers `/model/new`, `store_model_in_db`, and why the placeholder model returned 401.
- `apps/server/src/ai/litellm-client.ts`: the admin client, `redactSecrets` and `LitellmApiError`. Extend it in the same style.
- `apps/server/src/ais/service.ts`: `createAi` (all-or-nothing), the resumable `deleteAi`, and `llm_virtual_keys`.
- `apps/server/src/connections/service.ts`: `decryptForGatewayUse`. This is the only way to get the plaintext key.
- `apps/server/src/connections/providers.ts`: the provider ids.
- `apps/server/src/chats/routes.ts` and `apps/server/src/contacts/service.ts`
- `infra/litellm/config.yaml`, `infra/docker-compose.dev.yml` and `infra/.env.example`

### Allowed files
- `infra/litellm/config.yaml`: add `store_model_in_db: true` under `general_settings`, with a short comment. Nothing else.
- `infra/docker-compose.dev.yml`: pass `LITELLM_SALT_KEY` from the env file to the `litellm` service only. Nothing else.
- `infra/.env.example`: add `LITELLM_SALT_KEY=CHANGE_ME` with a comment. Set it once, before the first AI. **Changing it later makes every stored provider key unreadable.**
- `apps/server/src/ai/litellm-client.ts` and its test: model admin methods.
- `apps/server/src/ais/**`: service, routes, tests, and the integration test.
- `apps/server/src/db/schema.ts`, plus a new migration generated with the repo's real mechanism (`pnpm --filter @galena/server db:generate`). Don't write SQL by hand.
- `apps/server/src/chats/**`: list AIs.
- `apps/web/src/lib/api.ts` and `apps/web/src/store/realStore.ts`: only to carry an `isAi` flag from `/api/chats` onto the chat, so the existing `AiBadge` can show. If the store has no natural place for it, skip the web part and say so.
- `work/T-0033-ai-models-litellm.md`

**Not allowed:**
- `apps/server/src/connections/**`. Call `decryptForGatewayUse`, don't change it.
- `apps/mobile/**`
- `packages/**`
- `docs/**`
- any other file

**Do not restart, stop or recreate any Docker container.** Julio's live stack uses them. The lead restarts LiteLLM with the new config at review.

### Allowed dependencies
None.

### What to build

**1. Infra.** Covered by the three `infra/**` lines under Allowed files.

**2. LiteLLM admin client** (`litellm-client.ts`)
- `addModel({ modelName, litellmModel, apiKey, metadata })` calls `POST /model/new` and returns LiteLLM's model id.
- `deleteModel(modelId)` calls `POST /model/delete`. A model that is already gone counts as success, so deletes are idempotent.
- Add `getModelInfo` only if you need it.
- **The provider key is a secret in this call's request body.** Every error or log line from these methods goes through `redactSecrets` with that key.
- Test this explicitly: a fake LiteLLM whose error body echoes the key back produces an error with no key in it.
- Use the same zod validation of responses as the existing methods.

**3. Provider mapping.** Add a pure function with unit tests that maps our provider ids to LiteLLM model prefixes:

| Our provider | LiteLLM model |
|---|---|
| `openai` | `openai/<model>` |
| `anthropic` | `anthropic/<model>` |
| `google` | `gemini/<model>` |
| `deepseek` | `deepseek/<model>` |
| `xai` | `xai/<model>` |
| `openrouter` | `openrouter/<model>` |

`github` isn't an LLM provider. The service already rejects it with `connection_not_llm`; keep that.

**4. Storage.**
- Store the LiteLLM model id on the AI's key row as a new nullable column, e.g. `llm_virtual_keys.litellm_model_id`, so delete can remove it.
- Nullable, because AIs created before this task have none.

**5. Create** (`createAi`)
- Before issuing the virtual key:
  - decrypt the connection key with `decryptForGatewayUse`;
  - register the model `ai-<aiId>` via `addModel`, with `metadata: { ai_id }`;
  - then issue the virtual key with `models: ['ai-<aiId>']`.
- Keep `ai.model` as what the owner chose (`gpt-4o-mini`). The LiteLLM model name is derived from the AI id; it isn't a new column unless you need one.
- **All-or-nothing stays all-or-nothing.** A failure at any later step also deletes the registered model. Extend the existing tests that inject a failure at each step, including a failure *at* `addModel` and one *after* it.

**6. Delete** (`deleteAi`)
- Also delete the registered model, in a sensible order: revoke the key first, then delete the model.
- It must stay **resumable** the way T-0030 made it. A retry after a partial failure finishes the job, and a model id that's already null is skipped.

**7. Existing AIs.** Add an idempotent `ensureAiModel(deps, aiId)`:
- it registers the model if `litellm_model_id` is null;
- it updates the virtual key's allowlist to `['ai-<aiId>']` through the existing `updateKey`;
- it stores the id.

`createAi` may use it internally. T-0034 will call it before an AI's first turn. There's no route for it.

**8. `/api/chats` lists the caller's AIs.**
- Each **active** AI the caller owns appears as a `dm` entry:
  - `chatJid` = the AI's jid;
  - `title` = the AI's name;
  - `isAi: true`.
- Human entries get `isAi: false`, or leave the field out; pick one and be consistent.
- Keep the sort order.
- "Open chat" on My AIs (`/c/<jid>`) must then open that DM in the web app. That's the acceptance test for this item.
- Other people's AIs in shared rooms are **out of scope**. AIs can't join rooms yet.

### Tests (Vitest, no real network, no real keys)
- **Client:**
  - `addModel` and `deleteModel` success;
  - an already-gone model on delete counts as success;
  - **no key in any error** (the echo test).
- **Mapping:** every provider, plus the `github` rejection.
- **Create:**
  - the model is registered before the key;
  - the key's `models` is exactly `['ai-<id>']`;
  - a failure at or after `addModel` rolls everything back, including the model.
- **Delete:** the model is removed. A retry after a failed model delete finishes. A null model id is skipped.
- **`ensureAiModel`:** it's idempotent (the second call does nothing) and it fixes the allowlist of an old AI.
- **`/api/chats`:**
  - the caller's active AIs appear with `isAi`;
  - disabled AIs and other users' AIs don't appear.
- **No plaintext provider key in any response body or log line.** Use the existing logger test patterns.

### Integration check (gated, the lead runs it)
- Extend `apps/server/src/ais/integration.test.ts`, behind the existing gate or a new `GALENA_AI_MODELS_INTEGRATION=1`. Against the real LiteLLM it should:
  1. create an AI with a **made-up key** connection;
  2. assert that LiteLLM has model `ai-<id>`, and that `/key/info` for the virtual key lists only that model;
  3. call `POST /chat/completions` with the virtual key and model `ai-<id>`, and expect the **provider's** authentication error. That proves the call was routed to the provider with the owner's (fake) key, the same reasoning as in T-0007;
  4. delete the AI and assert the model and the key are both gone.
- It needs LiteLLM restarted with the new config and salt key, which you must **not** do. Write it and run it if LiteLLM already supports `/model/new`. Otherwise, say in the Report that the lead must run it.

### Acceptance criteria
- [ ] `pnpm format:check`, `lint`, `typecheck`, `test` and `build` all pass.
- [ ] A new AI's virtual key can only call `ai-<id>`, and that model carries the owner's key. Proven by unit tests, and by the gated integration test run by the lead.
- [ ] The provider key appears in no response, log line, error or DB column other than the existing encrypted `provider_connections` row.
- [ ] Create stays all-or-nothing and delete stays resumable, now including the model.
- [ ] "Open chat" from My AIs opens the AI's DM, because AIs are listed in `/api/chats`.
- [ ] `infra/.env.example` contains only `CHANGE_ME` placeholders.
- [ ] The Report says exactly what was run live and what wasn't.

### Checks (all must pass)
```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm exec turbo test --force
pnpm build
```

### Out of scope
- The AI actually replying: T-0034, which covers the XMPP login as the AI, context building, and the LiteLLM call.
- Budget reservation per turn, and the 80% and 100% room warnings.
- Changing a connection's key after AIs use it (there's no update route today).
- AIs in groups and rooms.
- OpenAI-compatible custom endpoints (Ollama and similar).

## Report (written by the worker when done)

## Review (written by Claude)

---
id: T-1413
title: "P0 task 6: remove LiteLLM from the code, config, compose files and dev stack; stop reading and writing llm_virtual_keys (the tables are dropped by a later task, expand/contract)"
status: merged
milestone: M5
branch: task/T-1413-remove-litellm
model: auto
effort: default
depends_on: [T-1399, T-1401, T-1405]
estimate: 1 day
---

# T-1413: Remove LiteLLM

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: **no LiteLLM**. Model calls go through Effect AI (`apps/server/src/ai/model-client.ts`, T-1399), provisioning no longer creates LiteLLM keys (T-1401), and spend lives in `ai_usage` (T-1405).

What's left is dead code, an unused env and a dev container. The plan is `docs/audit/effect-ai-plan.md` §5.7.

**Expand/contract** (AGENTS.md): this release **stops reading and writing** `llm_virtual_keys`. The tables `llm_virtual_keys` and `ai_daily_spend` are dropped by a **later** task, after this release is the only one running. So **no migration in this task.**

### Facts (the lead checked them on main, 2026-10-14)
- **The LiteLLM files:**
  - `apps/server/src/ai/litellm-client.ts`, `litellm-schemas.ts`, `litellm-types.ts`, `model-entry.ts`;
  - `apps/server/src/ais/litellm-model.ts`, `apps/server/src/ais/provisioning-keys.ts` (check what is still used).
- **Shared helpers that live in `litellm-client.ts`/`litellm-types.ts` and are still needed:**
  - `FetchLike`, imported by `agents/dm-tool-turn.ts:2`, `agents/dm-turn.ts:3`, `agents/group-turn.ts:3`, `agents/tool-loop.ts:13`, `ai/model-client.ts:10` and several tests;
  - `redactSecrets`, imported by `agents/redact-error.ts:4`, `agents/gateway/contracts.ts:5`, `ai/model-client.ts:10` and `leader/start.ts:9`.
  
  Move both into a new `apps/server/src/ai/http.ts` and update every importer.
- **`DEFAULT_LITELLM_BASE_URL` as the runner `gatewayUrl`:** `machines/hub.ts:4,263`, `leader/start.ts:153` and `main.ts:313`. The runner model listener is deleted later (desk-runner plan Task G).
  - **For now**, replace the import with a local constant `DEFAULT_MODEL_GATEWAY_URL` in `machines/hub.ts` (same value), with a one-line comment pointing to Task G.
  - Keep `config.LITELLM_BASE_URL`'s *use* there out of it: pass only the constant.
- **The admin client wiring:** `app.ts:2,99-101,557-574` (`aisLitellm`) and `main.ts:16,465-488` (`gatewayLitellm`, `masterKeyForRedaction`). `agents/gateway/contracts.ts:25-26` has `litellm?: LitellmAdminClient`.
- **Failure classification:** `agents/failure-class.ts:8,31-33` (the `LitellmApiError` branch) and the comment at `:37`.
- **Reads and writes of `llm_virtual_keys`:**
  - `ais/queries.ts:134-138` and `:197-202` (LEFT JOINs selecting `litellm_key_id` and `litellm_model_id`);
  - `ais/provisioning-xmpp.ts:66` (DELETE);
  - `connections/service.ts:115` (UPDATE).
  
  Remove them and any record fields that only carried those columns (`GatewayAiRecord` and friends).
- **Config:**
  - `apps/server/src/config.ts`: `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY` (plan §5.7 cites `:123-131,413-422`; re-check);
  - `logger.ts:27`: the master-key redaction; also `logger.test.ts`.
- **Comments and copy:**
  - `ai/catalog.ts:25`, `ais/usage.ts:46`, `ais/status.ts:9`, `ais/api.ts`, `ais/persona.ts`;
  - `connections/smoke-client.ts`, `connections/probe.ts`;
  - `packages/api-contract/src/ais.ts`, `packages/api-contract/src/middleware.ts:178-186`;
  - `packages/chat-core/src/ai-providers.ts`, `apps/web/src/lib/api/ais.ts`, `packages/runner-tunnel/src/demo.ts`.
- **Deploy and dev:**
  - `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/coolify/docker-compose.yml`: the `LITELLM_*` env lines;
  - `deploy/.env.example`, `apps/server/.env.example:52-53`, `infra/.env.example`;
  - `infra/docker-compose.dev.yml` (the litellm service);
  - `infra/litellm/config.yaml`;
  - `deploy/postgres/init/10-create-databases.sql` and `infra/postgres/init/10-create-databases.sql` (the litellm database; this affects new installs only);
  - `packages/devtools/src/smoke.ts` (the LiteLLM smoke checks).
- **Tests using the fake:**
  - `agents/gateway.test-harness.ts` (`FakeLitellm` at `:255-350`, the `llm_virtual_keys` insert at `:472-475`, the `litellm` harness parameter at `:531,573`);
  - `gateway-desk.test.ts`, `gateway-drain.test.ts`, `gateway-group.test.ts`, `reply.test.ts`, `ai/model-client.test.ts`, `ais/provisioning.test.ts`, `connections/update-key.test.ts`.
  
  Drop the fake and the parameter; keep each test's real assertion.
- `docs/` mentions are out of scope; leave them.

### What to build
1. **Delete the LiteLLM modules** listed above and move `FetchLike`/`redactSecrets` to `ai/http.ts`.
2. **Remove the admin client** from `app.ts`, `main.ts` and `gateway/contracts.ts`.
   - The AI routes must still build without it: they need only the cipher since T-1401. Check that `/api/ais` still mounts when `ZILAR_KEY_ENCRYPTION_KEY` is set.
   - The gateway must still start (`AGENT_GATEWAY_ENABLED=true`) with no LiteLLM config.
3. **Remove the `llm_virtual_keys` reads and writes,** and the record fields they fed.
4. **Remove the env** from config, the logger, both `.env.example` files, `infra/.env.example` and the three compose files; the dev stack loses the litellm service.
   - **Don't** remove any other env.
   - `deploy/coolify/docker-compose.app.yml` deploys on merge, so remove only the two `LITELLM_*` lines there.
5. `failure-class.ts`: drop the `LitellmApiError` branch and the LiteLLM comment; the rest is unchanged.
6. **Fix every comment and copy line** that still says LiteLLM (code and UI strings only; not `docs/`).
7. **At the end, `git grep -i litellm -- apps packages deploy infra ':!*.md' ':!**/drizzle/**'`** must print nothing except references to the old tables in SQL migrations. Paste the output in the Report.

### Tests (pipeline: keep them, don't add many)
The existing tests keep passing with the fake removed:
- `gateway-*.test.ts`, `reply.test.ts`, `ai/model-client.test.ts`, `ais/provisioning.test.ts`, `connections/update-key.test.ts`;
- `failure-class` tests if any exist.

No new tests are needed.

### Read first
`AGENTS.md`, `docs/audit/effect-ai-plan.md` §5.7, and the files above.

### Allowed files
`apps/server/src/**`, `apps/server/.env.example`, `apps/web/src/lib/api/ais.ts`, `packages/api-contract/src/ais.ts`, `packages/api-contract/src/middleware.ts`, `packages/chat-core/src/ai-providers.ts`, `packages/runner-tunnel/src/demo.ts`, `packages/devtools/src/smoke.ts`, `deploy/docker-compose.yml`, `deploy/coolify/docker-compose.app.yml`, `deploy/coolify/docker-compose.yml`, `deploy/.env.example`, `deploy/postgres/init/10-create-databases.sql`, `infra/**`, `work/T-1413-remove-litellm.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents src/ais src/connections src/ai --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes and the `git grep` is clean; every file is at most 400 lines.
- There's no new migration.
- With `AGENT_GATEWAY_ENABLED=true` and no `LITELLM_*` env, the server starts locally and `/api/ais` answers. Say how you checked.

---

## Report (written by the worker when done)

**Status:** review-ready. `pnpm gate` → GATE PASS, scope clean.

### What I did

1. **Deleted the LiteLLM modules:** `ai/litellm-client.ts`, `ai/litellm-schemas.ts`,
   `ai/litellm-types.ts`, `ai/model-entry.ts`, `ais/litellm-model.ts`,
   `ais/provisioning-keys.ts`, and `infra/litellm/config.yaml`.
2. **Moved the still-used helpers** `FetchLike` and `redactSecrets` into new
   `apps/server/src/ai/http.ts` and updated every importer (agents, model client,
   connection probe, gateway contracts, leader start, and the tests).
3. **Kept the still-used pieces of the deleted files:**
   - `isLlmProvider` (used by `provisioning.ts`) moved to `connections/providers.ts`
     (the home of `PROVIDER_IDS`). `litellmModelFor` was dead and is gone.
   - `changeAiModel` + `ChangeAiModelInput` (used by `provisioning.ts` and the
     `service.ts` barrel) moved into `provisioning.ts`. The no-op `ensureAiModel`
     stub (T-1401 deferred its deletion to this task) is removed, with its stale
     references in comments.
4. **Removed the admin client** from `app.ts` (`aisLitellm`), `main.ts`
   (`gatewayLitellm`, `masterKeyForRedaction`) and `agents/gateway/contracts.ts`
   (`litellm?`, `masterKeyForRedaction`). `gateway.ts`'s `secretsFor` now only
   carries the per-turn provider key. AI routes need only the cipher.
5. **Removed the `llm_virtual_keys` reads/writes:** the two LEFT JOINs and
   `litellm_key_id`/`litellm_model_id` columns in `ais/queries.ts` (and the
   `litellmKeyId`/`litellmModelId` record fields), the DELETE in
   `ais/provisioning-xmpp.ts`, and the UPDATE in `connections/service.ts`.
   No migration is added (the tables are dropped by a later task).
6. **Removed the env/config:** `LITELLM_BASE_URL` and `LITELLM_MASTER_KEY` from
   `config.ts` (schema, `EMPTY_MEANS_UNSET_KEYS`) and `LITELLM_MASTER_KEY` from the
   logger redaction list (and its test); the `LITELLM_*` lines in the three compose
   files and the two `.env.example`s; `LITELLM_DB_PASSWORD`/`LITELLM_MASTER_KEY`/
   `LITELLM_SALT_KEY`/`PLACEHOLDER_API_KEY` from `infra/.env.example`; the `litellm`
   service and its `LITELLM_DB_PASSWORD` from `infra/docker-compose.dev.yml`; the
   litellm role/database from both `postgres/init/10-create-databases.sql` files;
   and the LiteLLM smoke check from `packages/devtools/src/smoke.ts`.
7. **Runner `gatewayUrl`:** added `DEFAULT_MODEL_GATEWAY_URL` (same value,
   `http://127.0.0.1:4000`) in `machines/hub.ts`, with a comment pointing at the
   desk-runner plan Task G that deletes the runner model listener; `main.ts` and
   `leader/start.ts` now pass only that constant (no `config.LITELLM_BASE_URL`).
8. **Failure classification:** dropped the `LitellmApiError` branch and the LiteLLM
   comment from `agents/failure-class.ts`; the rest is unchanged.
9. **Fixed every remaining LiteLLM comment/copy** in code (catalog, usage, status,
   api, persona, connections, gateway dm-turn, web `ais.ts`, api-contract
   `ais.ts`/`middleware.ts`, chat-core `ai-providers.ts`, runner-tunnel `demo.ts`,
   `leader/lock.ts`'s stale `ENSURE_MODEL_LOCK_SCOPE` reference). `docs/` untouched.
10. **Tests:** dropped `FakeLitellm` and the harness `litellm` parameter, the
    `llm_virtual_keys` seed in `seedAi`, and the `modelId` override; updated the
    callers (`gateway-desk`, `gateway-drain`, `gateway-group`). Kept each test's real
    assertion. In `update-key.test.ts` I dropped the "clears the AI model id"
    assertion (the write it checked no longer exists) and kept the encrypted-storage,
    404 and no-leak assertions; in `provisioning.test.ts` I dropped the `keys`
    counter and the "drops an old virtual-key row on delete" test (that DELETE is
    gone) and kept create/edit/delete and the refusals.

### Files changed

63 files against `main` (see `git status`): 6 deleted modules, 1 new `ai/http.ts`,
1 new `connections/providers.ts` content, plus code/test/env/compose edits listed in
the spec's Allowed files. Nothing outside Allowed files.

### Commands and real results

- `pnpm install` → Done (frozen lockfile honoured).
- `pnpm --filter @zilar/server exec vitest run src/agents src/ais src/connections src/ai --maxWorkers=2 --reporter=dot`
  → **Test Files 15 passed (15), Tests 80 passed (80)**, 14.91s.
- `git grep -i litellm -- apps packages deploy infra ':!*.md' ':!**/drizzle/**'`
  → **no output** (exit 1). (See below.)
- `pnpm gate` (from repo root) → 63 changed files against `main`:
  ```
  PASS  install (frozen)  (1.5s)
  PASS  format  (1.7s)
  PASS  lint  (1.1s)
  PASS  typecheck  (6.3s)
  PASS  effect  (1.6s)
  SKIP tests @zilar/api-contract (no nearby test files)
  PASS  tests @zilar/chat-core  (1.3s)
  SKIP tests @zilar/devtools (no nearby test files)
  PASS  tests @zilar/runner-tunnel  (1.5s)
  PASS  tests @zilar/server  (18.0s)
  PASS  tests @zilar/web  (5.2s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```

### Requirement 7 output

`git grep -i litellm -- apps packages deploy infra ':!*.md' ':!**/drizzle/**'`
prints nothing (exit 1). The old `llm_virtual_keys.litellm_key_id`/
`litellm_model_id` column names only remain in `apps/server/drizzle/**`, which the
command excludes and which this task leaves alone.

### Acceptance checks

- **Gate passes, scope clean, no new migration** — see the gate output above.
- **Every file ≤ 400 lines** — every file I created is small. Three pre-existing
  files stay over 400 lines (`app.ts` 574, `main.ts` 560, `config.ts` 518) but each
  was already over 400 on `main` (583 / 569 / 526) and my edits only shrink them; the
  lint `max-lines` rule is a warning and the gate is green.
- **Server starts with no `LITELLM_*` env and `/api/ais` answers** — I did **not**
  boot the full server binary (it needs Postgres and ejabberd; AGENTS.md forbids
  daemons). Instead the existing suite proves both halves with no gateway client in
  scope at all (the type no longer has one): `src/ais/provisioning.test.ts` mounts
  `createApp` with only the key cipher and exercises `POST`/`PATCH`/`DELETE /api/ais`
  (mounted and answering), and the gateway tests (`gateway-desk`, `gateway-drain`,
  `gateway-group`) call `gateway.start()` with `enabled: true`, a cipher and no
  gateway client. `config.ts` no longer reads any `LITELLM_*` key, and `main.ts`
  builds no gateway client, so `AGENT_GATEWAY_ENABLED=true` cannot depend on them.

### Deviations / notes

- The spec said to remove "only the two `LITELLM_*` lines" from
  `deploy/coolify/docker-compose.app.yml`; I also removed the four comment lines
  directly above them, because they mention LiteLLM and requirement 7 must be clean.
  No other env line there changed.
- `infra/.env.example`'s `PLACEHOLDER_API_KEY` existed only for the deleted
  `infra/litellm/config.yaml`, so it is removed too.
- I chose `apps/server/src/connections/providers.ts` as the new home of
  `isLlmProvider` (next to `PROVIDER_IDS`); `chat-core`'s comment was repointed
  there.

### Blocked / needs a decision

None.

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN, nit 2.
- The litellm grep over apps, packages, deploy and infra is clean; there's no migration (the llm_virtual_keys and ai_daily_spend drop is a later task); net -1025 lines.
- 15 server test files pass locally (80 tests).
- The Coolify compose loses only the two LITELLM_* lines.
- After deploy: check /health, that the gateway starts with no 'disabled' log, and that /api/ais answers.

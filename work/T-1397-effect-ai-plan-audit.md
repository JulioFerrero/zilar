---
id: T-1397
title: "Audit (no code): plan to replace LiteLLM with Effect AI (effect/ai plus @effect/ai-* providers) so AIs answer in production; map every LiteLLM touchpoint, check the Effect AI API, and split the work into tasks"
status: merged
milestone: M5
branch: task/T-1397-effect-ai-plan-audit
model: auto
effort: default
depends_on: []
estimate: 0.5 day
---

# T-1397: Effect AI instead of LiteLLM (audit)

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14, decided the agent system design (`docs/design/agent-system.md`, read §2.1, §6 P0 and §7):
- **The model calls move into our server, through Effect AI.** LiteLLM goes away.
- **No default daily budget.** Spend is still counted per AI.

Production has no LiteLLM today: the live `LITELLM_BASE_URL` is the compose placeholder (`deploy/coolify/docker-compose.app.yml:181`), so no AI can answer live. P0 fixes that. This audit maps the work so the coding tasks are exact.

Facts the lead checked (2026-10-14):
- **Effect 4 ships the AI core inside `effect` itself:** `node_modules/.pnpm/effect@4.0.2/node_modules/effect/src/ai/` (`LanguageModel.ts`, `Tool.ts`, `Chat.ts`, `Prompt.ts`, `Response.ts`, `AiError.ts`, `McpServer.ts`, `Tokenizer.ts`). The repo pins `effect: ^4.0.2` (`pnpm-workspace.yaml:11`).
- **Effect 4 provider packages on npm are at `4.0.4`** (peer `effect ^4.0.4`): `@effect/ai-openai`, `@effect/ai-anthropic`, `@effect/ai-openrouter`, `@effect/ai-openai-compat`. `@effect/ai-google` and `@effect/ai-amazon-bedrock` are only on the old 0.x line (Effect 3), so they are out.
- **The model call today:** `apps/server/src/agents/tool-loop.ts:223` POSTs `${baseUrl}/chat/completions` with the AI's LiteLLM virtual key and parses the SSE in `apps/server/src/agents/stream.ts` (191 lines). `tool-loop.ts` is at the 400-line limit.
- **The LiteLLM admin client** `apps/server/src/ai/litellm-client.ts` (285 lines; types in `litellm-types.ts`, `litellm-schemas.ts`) is used by:
  - provisioning (`apps/server/src/ais/provisioning.ts`, `provisioning-keys.ts`, `provisioning-xmpp.ts`);
  - usage (`apps/server/src/ais/usage.ts:46-90`, which reads the key spend);
  - budgets (`apps/server/src/agents/gateway/budget.ts:59-195`).
- **The model entry** is `apps/server/src/ai/model-entry.ts`; the provider prefix map is `apps/server/src/ais/litellm-model.ts`.
- **The listener model** is paid by the server, not an owner (`apps/server/src/config.ts:257-261`, `LISTENER_MODEL`).
- **The virtual-key table** is `llm_virtual_keys.litellm_key_id` (`apps/server/drizzle/0005_clean_frightful_four.sql:27`). The latest migration is `0054_push_failure_reason.sql`; new migrations are hand-written SQL.
- **Owner keys** are sealed in `provider_connections` (`apps/server/src/connections/crypto.ts`).
- **About 40 server files mention LiteLLM** (`git grep -il litellm -- apps/server/src`), plus `packages/devtools/src/smoke.ts` and `packages/api-contract/src/ais.ts`.

### What to build
One document, `docs/audit/effect-ai-plan.md`, covering:
1. **Inventory:** every LiteLLM touchpoint (server, contract, devtools, compose and env), with `file:line` and what it does: chat call, admin, spend, budget, provisioning or config.
2. **The Effect AI API, verified in the source** (`effect/src/ai/*` for 4.0.x, and the 4.0.4 provider packages: `npm pack` them into a temp folder outside the repo and read them). For each point, cite the source file and line:
   - how to build a `LanguageModel` for one call with a **per-call API key and base URL**: we have one key per AI, decrypted per call, not one global key;
   - tool definitions (`Tool`, toolkits);
   - tool-call results;
   - **streaming**;
   - **token usage** on the response (input, output, cached);
   - error types (`AiError`) and how they map to our failure classes (`apps/server/src/agents/failure-class.ts`);
   - timeouts and cancellation.
3. **Provider mapping:**
   - openai → `@effect/ai-openai`;
   - anthropic → `@effect/ai-anthropic`;
   - openrouter → `@effect/ai-openrouter`;
   - **deepseek, xai and google** → `@effect/ai-openai-compat` with their OpenAI-compatible base URLs (find and cite the official URLs);
   - also the OpenAI-compatible custom provider planned in `work/T-1396-*.md`.

   Note any gaps: tool calling or streaming on a compat endpoint, and Anthropic prompt caching.
4. **The new design** in our server:
   - a `ModelClient` service (name and folder): `chat({ connection, model, messages, tools, signal })` returns a stream or a result with usage;
   - how the agent loop (`tool-loop.ts`, `dm-turn.ts`, `dm-tool-turn.ts`, `group-turn*.ts`, `gateway/*`) switches to it while keeping our message and tool shapes, or why it should move to `effect/ai` `Prompt` and `Tool` directly;
   - **usage and cost:** a new table, for example `ai_usage(ai_id, day, input_tokens, output_tokens, cached_tokens, cost_usd)`, written after every call. Prices come from the models.dev catalog (`apps/server/src/ai/catalog.ts` from T-1395, if merged, else name it);
   - **budgets:** only when the owner set a limit (no default), checked before each call. Replace `budget.ts` and `usage.ts`;
   - **provisioning without LiteLLM:** what `provisioning*.ts` keeps (XMPP account, avatar) and what it drops (virtual keys, `/model/new`);
   - **the listener model:** which key pays for it now, or turn it off;
   - **removing** `llm_virtual_keys` and the `LITELLM_*` env (config, compose, `.env.example`), and the migration that drops them.
5. **The task split:** ordered tasks of at most about 600 changed lines, every file at most 400 lines. For each task: its files, `file:line` anchors, what gets deleted, and the tests it needs. Tests are allowed here (money and the message pipeline) but keep them few: usage accounting, the budget check, and one fake-provider round trip with a tool call. The **first** task must make a DM to an AI answer end to end against a fake OpenAI-compatible HTTP server.
6. **Live check:** how the lead checks it after deploy. Julio's real key goes in through the app's Connections screen, never by the lead.
7. **Risks and open questions.**

Change no code. Do not add packages to the repo; read the provider packages from a temp folder outside it.

### Read first
`AGENTS.md`, `docs/design/agent-system.md`, `docs/audit/ai-gateway-options.md`, and the files above.

### Allowed files
`docs/audit/effect-ai-plan.md`, `work/T-1397-effect-ai-plan-audit.md`.

### Checks
```bash
pnpm exec prettier --check docs/audit/effect-ai-plan.md
```

### Acceptance
- `docs/audit/effect-ai-plan.md` exists, cites `file:line` for every claim about our code, and cites the Effect source file for every API claim.
- It gives the task split.
- No code changes.

---

## Report (written by the worker when done)

Wrote `docs/audit/effect-ai-plan.md` (the one deliverable) and changed no other
file. No code changed: the only tracked edits are this task file and that doc.

### What the doc contains
1. **Inventory** of every LiteLLM touchpoint: the chat call (`tool-loop.ts:218-358`,
   `stream.ts:68-191`), the admin client (`ai/litellm-client.ts:49-285` +
   schemas/types, `ai/model-entry.ts`), provisioning
   (`ais/provisioning*.ts`, `ais/litellm-model.ts`), spend (`ais/usage.ts:61-166`),
   budgets (`gateway/budget.ts`), the gateway/startup wiring
   (`gateway/contracts.ts`, `main.ts:461-483`, `app.ts`, `leader/start.ts`,
   `machines/hub.ts`), the DB (`drizzle/0005:25-32`, `0006:1-2`), config/env/compose
   (`config.ts`, `logger.ts`, the three compose files, the three `.env.example`s),
   and the contract/devtools/web touches. Each row cites `file:line` and what it does.
2. **The Effect AI API**, verified in the 4.0.2 core source under
   `node_modules/.pnpm/effect@4.0.2/node_modules/effect/src/ai/`: per-call
   `LanguageModel` with key + base URL (all four providers expose effectful
   `make({ apiKey, apiUrl })`), `Tool`/`Toolkit`, tool-call results, streaming,
   token usage (input/output/cacheRead/cacheWrite), `AiError` reasons and their
   mapping onto `failure-class.ts`, and timeouts/cancellation (the fetch signal).
   Every API claim cites an Effect source file and line.
3. **Provider mapping** with official base URLs (DeepSeek `https://api.deepseek.com`,
   xAI `https://api.x.ai/v1`, Gemini OpenAI-compat
   `https://generativelanguage.googleapis.com/v1beta/openai/`) and the gaps
   (effect must go to `^4.0.4`; compat always sends `stream_options`; OpenAI uses
   `/responses`; Anthropic caching is supported).
4. **The new design**: a per-call `ModelClient` (`ai/model-client.ts` +
   `ai/providers.ts`), the loop swap, the `ai_usage` table + models.dev cost, the
   owner-only budget check, provisioning without virtual keys, the listener
   decision, and the `llm_virtual_keys`/`LITELLM_*` removal with an expand/contract
   migration.
5. **A 6-task split** (<=~600 lines each, files <=400), whose first task makes a
   DM answer end to end against a fake OpenAI-compatible HTTP server, with the
   three tests allowed (usage accounting, budget check, fake-provider tool round).
6. **Live check** (Julio's key via the Connections screen; the lead never sees it)
   and **risks/open questions**.

### Provider packages
Read only. I unpacked `@effect/ai-openai@4.0.4`, `@effect/ai-anthropic@4.0.4`,
`@effect/ai-openrouter@4.0.4` and `@effect/ai-openai-compat@4.0.4` with `npm pack`
into `/private/var/folders/gm/.../T/opencode/t1397-ai/` (outside the repo) and
read them there. Nothing was added to the repo.

### Commands (real results)
- `pnpm install` — done (1247 packages; one pre-existing peer warning in
  `apps/mobile`: `@types/react-dom` wants `@types/react ^19.3.0`, found 19.2.18;
  not related to this task).
- `pnpm exec prettier --check docs/audit/effect-ai-plan.md` — "All matched files
  use Prettier code style!".
- `pnpm gate` (from the repo root), summary lines:
  ```
  gate: 2 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.0s)
  PASS  lint  (0.9s)
  PASS  typecheck  (1.2s)
  SKIP effect (no source files changed)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
  Changed files: `docs/audit/effect-ai-plan.md` (new) and
  `work/T-1397-effect-ai-plan-audit.md` (this report) — both in Allowed files.
  No package tests were run because no package source changed.

### Deviations / notes for the lead
- The task said "read the provider packages" — done, but **`effect` must be
  bumped from `^4.0.2` to `^4.0.4`** before the provider packages can be added,
  because all four peer on `effect ^4.0.4`. Called out in §3.0 and §8.
- `apps/server/src/ai/catalog.ts` (T-1395) is **not merged yet**, so the pricing
  source is named but not linked to a real file; the plan notes the fallback.
- The `ai_usage` migration number is left as "next free at build time"
  (T-1396 plans to take 0055).

### Open questions (do not block this audit)
- Bump only `effect`, or the whole 4.0.x set (`@effect/atom-react`, `@effect/sql-*`
  are 4.0.2 in `pnpm-workspace.yaml:6`)?
- Listener: turn it off for P0, or require an owner-delegated AI? (Recommended:
  off unless an owner attaches a connection.)
- Cost stored at call time (recommended) or re-derived from the catalog later?

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN (nit 2, carried into the task specs: SET lock_timeout on every new migration, connection loaded only through the AI's own provider_connection_id). Lead decisions on §8: bump effect and every @effect/* to the same 4.0.4; the listener is off in P0 (no platform key); cost is a snapshot at call time.

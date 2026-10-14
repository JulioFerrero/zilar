# Replacing LiteLLM with Effect AI: audit and build plan

Written 2026-10-14 for task T-1397, after Julio's decision of 2026-10-14
(`docs/design/agent-system.md` §2.1, §6 P0, §7): **model calls move into our
server through Effect AI, LiteLLM goes away, and there is no default daily
budget** (spend is still counted per AI).

Status: **audit only, no code changed in this task.** Every claim about our code
below cites `file:line` as it is on `task/T-1397-effect-ai-plan-audit`
(2026-10-14). Every claim about the Effect AI API cites the file in
`node_modules/.pnpm/effect@4.0.2/node_modules/effect/src/...`, or one of the
4.0.4 provider packages unpacked from npm tarballs into a temp folder outside
the repo (see §3.1). The provider packages are **not** added to the repo by this
task.

## 1. Why this exists

Production has no LiteLLM. The live `LITELLM_BASE_URL` is the compose
placeholder `http://127.0.0.1:9` (`deploy/coolify/docker-compose.app.yml:181`),
so no AI can answer in production today; nobody noticed because nobody has
created an AI yet. P0 replaces the LiteLLM client with in-process Effect AI calls
and makes AI replies work.

## 2. Inventory: every LiteLLM touchpoint

`git grep -il litellm` lists ~40 server files plus the contract, devtools, the
web app, compose and env examples. Grouped by what the code does.

### 2.1 The chat call (the model request itself)

| Location | What it does |
|---|---|
| `apps/server/src/agents/tool-loop.ts:218-358` | `requestCompletionEffect`/`requestCompletion`: POSTs `${baseUrl}/chat/completions` (`:223`) with `authorization: Bearer ${virtualKey}` (`:245`), `max_tokens: REPLY_MAX_TOKENS`, `stream: true` and `tool_choice: 'auto'` (`:224-230`). Maps HTTP/stream/JSON failures to `ChatCompletionError`. |
| `apps/server/src/agents/tool-loop.ts:20` | `LITELLM_CHAT_TIMEOUT_MS = 90_000` — the per-call timeout. |
| `apps/server/src/agents/stream.ts:68-191` | `consumeChatCompletionStream`: parses the OpenAI/LiteLLM SSE (`choices[0].delta`, tool-call pieces by `index`, `finish_reason`). Used only by `tool-loop.ts:3`. |
| `apps/server/src/agents/tool-loop.ts:89-98,121-140` | Our wire message shape (`ModelRequestMessage`) and `ChatCompletionResult` (`content`, `toolCalls`, `finishReason`). |
| `apps/server/src/agents/dm-turn.ts:44-49,112-123` | `DmTurnDeps` carries `baseUrl` + `virtualKey`; builds `CompleteChatInput`. |
| `apps/server/src/agents/dm-tool-turn.ts:57,224,383` | The shared tool loop carries `virtualKey` and redacts it. |
| `apps/server/src/agents/group-turn.ts:38,152,189` | Group turn carries `virtualKey`. |
| `apps/server/src/agents/reply.ts:19` | Re-exports `LITELLM_CHAT_TIMEOUT_MS`. |
| `apps/server/src/agents/tool-exec.ts:2` | Imports `redactSecrets` from the LiteLLM client (redaction only, not a call). |
| `apps/server/src/connections/probe.ts:2`, `apps/server/src/connections/smoke-client.ts:2` | Also import `redactSecrets` from the client. |

The runtime key that authenticates the chat call is the AI's **virtual key**,
stored encrypted in `llm_virtual_keys.encrypted_key` and decrypted per turn:
`apps/server/src/agents/gateway/dm-turn.ts:178-215` and
`apps/server/src/agents/gateway/group-turn-body.ts:109-145,279` call
`loadEncryptedVirtualKey` (`gateway/db.ts:258-266`) and then
`cipher.decrypt` (`:184` / `:115`). The owner's real provider key is decrypted
only at provisioning/migration time (`connections/service.ts:183-214`,
`ais/provisioning.ts:103`, `ais/provisioning-keys.ts:122,229`) and handed to
LiteLLM, never used at call time.

### 2.2 The LiteLLM admin client

| Location | What it does |
|---|---|
| `apps/server/src/ai/litellm-client.ts:49-285` | The admin client: `generateKey` (`:108`), `getKeyInfo` (`:137`), `updateKey` (`:160`), `revokeKey` (`:190`), `addModel` (`:210`), `deleteModel` (`:236`), `listModels` (`:253`). Uses the Bearer master key (`:91-96`). |
| `apps/server/src/ai/litellm-client.ts:271-285` | `createLitellmAdminClientFromConfig`. |
| `apps/server/src/ai/litellm-schemas.ts` (239 lines) | Effect Schemas for every admin response. |
| `apps/server/src/ai/litellm-types.ts:3` | `DEFAULT_LITELLM_BASE_URL = 'http://127.0.0.1:4000'`; `LitellmApiError` (`:8-22`). |
| `apps/server/src/ai/model-entry.ts:63-81` | `buildUserModelEntry` builds the `model_list` entry POSTed to `/model/new`; `modelNameForAi` (`:79`). |

### 2.3 Provisioning (per-AI keys and models)

| Location | What it does |
|---|---|
| `apps/server/src/ais/provisioning.ts:102-123` | On create: `addModel` (`:104`), `generateKey` with `maxBudget` (`:111`), `INSERT INTO llm_virtual_keys …` (`:123`). |
| `apps/server/src/ais/provisioning.ts:201-242` | On limit change: `updateKey` cap (`:205`) and the row update (`:242`). |
| `apps/server/src/ais/provisioning-keys.ts:54-67` | `addModel` + `updateKey(models:)` + rollback `deleteModel`. |
| `apps/server/src/ais/provisioning-keys.ts:122-138` | Reclaim a stray model name, `addModel`, and pointer update. |
| `apps/server/src/ais/provisioning-keys.ts:229-257` | Model change: `deleteModel`, `addModel` under a transaction. |
| `apps/server/src/ais/provisioning-xmpp.ts:49-101,163-173` | On delete: `revokeKey` (`:56`,`:163`), `deleteModel` (`:87`,`:173`), `DELETE FROM llm_virtual_keys` (`:101`). |
| `apps/server/src/ais/litellm-model.ts:8-30` | Maps our provider ids to LiteLLM model prefixes (`gemini` for google, etc.). |

### 2.4 Spend and usage

| Location | What it does |
|---|---|
| `apps/server/src/ais/usage.ts:61-166` | `getAiUsage` joins `llm_virtual_keys.litellm_key_id` (`:66-71`) and reads the key's cumulative spend via `litellm.getKeyInfo` (`:83`); derives today's spend from `ai_daily_spend` (`:98-153`). |
| `apps/server/src/ais/api.ts:58-76,112-141` | AIs list/detail include a usage summary; the AI routes are gated on the client + cipher (`:119`,`:141`). |
| `apps/server/src/ais/queries.ts:119-135,189-190,220-231` | Reads `llm_virtual_keys.litellm_key_id` / `litellm_model_id` into the AI record. |
| `apps/server/src/ais/persona.ts:8,50` | Persona flows take the admin client. |
| `apps/server/src/ais/status.ts:9` | Comment: the kill switch stays up when LiteLLM is down. |
| `apps/server/src/agents/gateway/budget.ts:59-123,184-206` | `checkDailyLimit`/`checkDmRoundGate` read usage and stop the turn at the daily cap; `sendBudgetWarnings` (`:130-177`) sends the 80% notices. |
| `apps/server/src/agents/failure-class.ts:8,31-35,41` | Classifies `LitellmApiError` and a "budget" detail string into failure kinds. |

### 2.5 Gateway wiring and startup

| Location | What it does |
|---|---|
| `apps/server/src/agents/gateway/contracts.ts:5,23-32` | `AgentGatewayDeps.litellm?` (absent = gateway off) and `litellmBaseUrl?`. |
| `apps/server/src/agents/gateway.ts:3,66,136` | Defaults `baseUrl` from `DEFAULT_LITELLM_BASE_URL`, passes `litellm`. |
| `apps/server/src/agents/gateway/lifecycle.ts:137-138` | Gateway stays off without LiteLLM + cipher. |
| `apps/server/src/agents/gateway/listener.ts:185` | The listener calls the model with `virtualKey: listener.virtualKey`. |
| `apps/server/src/main.ts:461-483` | Builds the cipher and `createLitellmAdminClientFromConfig` (`:465-468`); listener needs `LISTENER_MODEL` + `LITELLM_MASTER_KEY` (`:472-477`). |
| `apps/server/src/app.ts:2,99-101,557-565` | Builds the admin client for the AI routes (tests inject a fake). |
| `apps/server/src/leader/start.ts:9,153,173` | Passes `gatewayUrl` and the master key secret into the leader work. |
| `apps/server/src/machines/hub.ts:4,263-269` | The runner hub checks a `gatewayUrl` (defaults to `DEFAULT_LITELLM_BASE_URL`); this is a leftover name, unrelated to model calls. |

### 2.6 Database

| Location | What it does |
|---|---|
| `apps/server/drizzle/0005_clean_frightful_four.sql:25-32` | `CREATE TABLE llm_virtual_keys` (`ai_id` PK, `litellm_key_id`, `encrypted_key`, `budget_usd`, `budget_duration`). |
| `apps/server/drizzle/0006_military_sleepwalker.sql:1-2` | Relaxes `litellm_key_id` to nullable and adds `litellm_model_id`. |
| `apps/server/drizzle/0005_clean_frightful_four.sql:1-24` | `ai_limits` (`per_day_usd`, `per_month_usd`) and `ai_daily_spend` (spend-baseline table) live here too; both are read by `ais/usage.ts`. |

Latest migration on this branch: `0054_push_failure_reason.sql`.

### 2.7 Config, env and compose

| Location | What it does |
|---|---|
| `apps/server/src/config.ts:123-131` | `LITELLM_BASE_URL` / `LITELLM_MASTER_KEY` (both optional). |
| `apps/server/src/config.ts:257-261` | `LISTENER_MODEL` documented as "paid with the server's LiteLLM master key". |
| `apps/server/src/config.ts:413-422` | `LITELLM_MASTER_KEY` in `EMPTY_MEANS_UNSET_KEYS`. |
| `apps/server/src/logger.ts:27` | Redacts `LITELLM_MASTER_KEY` from logs. |
| `apps/server/.env.example:52-53` | Comment naming the two vars. |
| `deploy/.env.example:81-89` | The optional gateway block. |
| `deploy/coolify/docker-compose.app.yml:181,184` (and `deploy/coolify/docker-compose.yml:155,158`, `deploy/docker-compose.yml:163,166`) | Injects the two vars; the app default is the unreachable placeholder. |
| `deploy/postgres/init/10-create-databases.sql:10` | Comment about the (absent) LiteLLM role. |
| `infra/.env.example:21-46` | Dev-only: `LITELLM_DB_PASSWORD`, `LITELLM_MASTER_KEY`, `LITELLM_SALT_KEY`. |
| `infra/litellm/config.yaml` | Dev-only LiteLLM proxy config (`store_model_in_db: true`). |

### 2.8 Contract, devtools and web

| Location | What it does |
|---|---|
| `packages/api-contract/src/ais.ts:98-105` | `AiUsage` (`todayUsd`, `windowUsd`) documented as "null when LiteLLM cannot be reached". |
| `packages/api-contract/src/middleware.ts:178-186` | `AisConfigured`, the 503 gate "of the AI routes that need LiteLLM and the key cipher". |
| `packages/devtools/src/smoke.ts:8,23,29,39,45,121-124` | Dev smoke test: Postgres user/db `litellm` and a `GET http://127.0.0.1:4000/health/liveliness` check. |
| `apps/web/src/lib/api/ais.ts:173` | Comment about `litellm_model_id`. |
| `apps/web/src/components/ais/AiUsageSection.tsx:40-50` | "Usage" block reading the AI's spend summary. |

## 3. The Effect AI API, verified in the source

### 3.0 What ships where

- **The AI core ships inside `effect` 4.0.2 itself**, at
  `node_modules/.pnpm/effect@4.0.2/node_modules/effect/src/ai/`:
  `index.ts` re-exports `AiError`, `Chat`, `LanguageModel`, `Model`, `Prompt`,
  `Response`, `Tool`, `Toolkit`, `Tokenizer`, `DecisionModel`,
  `EmbeddingModel`, `McpServer`, and telemetry (`effect/src/ai/index.ts:12-126`).
  The repo pins `effect: ^4.0.2` (`pnpm-workspace.yaml:11`).
- **The provider packages are on the 4.0.4 line** and their only peer is
  `effect: ^4.0.4` (per the tarballs, §3.1). The repo's pinned `^4.0.2` resolves
  to 4.0.2, so a P0 task must **bump `effect` to `^4.0.4`** in
  `pnpm-workspace.yaml:11` before adding them. `@effect/ai-google` and
  `@effect/ai-amazon-bedrock` exist only on the old 0.x (Effect 3) line and are
  out; Google goes through the OpenAI-compatible package (§4).

### 3.1 How the provider sources were read

The four provider packages were unpacked **outside the repo** with
`npm pack @effect/ai-openai@4.0.4 @effect/ai-anthropic@4.0.4
@effect/ai-openrouter@4.0.4 @effect/ai-openai-compat@4.0.4` into
`/private/var/folders/gm/.../T/opencode/t1397-ai/`. Citations below use the
paths `@effect/ai-openai-compat/src/...`, etc., after unpacking. Nothing from
these tarballs was added to the repo.

### 3.2 Building a `LanguageModel` for one call with a per-call key and base URL

We have one key per AI (the owner's provider key, decrypted per call), not one
global key, so the model must be built per call. All four packages support this:
each exposes an **effectful `make(options)` constructor** that takes the key and
URL as plain values (not `Config`), plus `layer(options)`:

- `@effect/ai-openai-compat/src/OpenAiClient.ts:141-283` — `make(options)`; the
  options type at `:97-103` has `apiKey?: Redacted<string>` and
  `apiUrl?: string`. `make` prepends `apiUrl ?? "https://api.openai.com/v1"`
  (`:148`) and adds the bearer token (`:149-151`). `layer` at `:300-301`,
  `layerConfig` at `:325-355`.
- `@effect/ai-openai/src/OpenAiClient.ts:197` — `make`; options `apiKey` `:132`,
  `apiUrl` `:139`, default `https://api.openai.com/v1` `:202`.
- `@effect/ai-anthropic/src/AnthropicClient.ts:228` — `make`; `apiKey` `:171`,
  `apiUrl` `:178`, default `https://api.anthropic.com` `:236`.
- `@effect/ai-openrouter/src/OpenRouterClient.ts:175` — `make`; `apiKey` `:123`,
  `apiUrl` `:129`, default `https://openrouter.ai/api/v1` `:193`.

The language model itself needs only that client:

- `@effect/ai-openai-compat/src/OpenAiLanguageModel.ts:611-702` — `make({ model,
  config })` yields a `LanguageModel.LanguageModel` with requirement
  `OpenAiClient` (`:614-615`). `model(name, config?)` at `:572-576` returns an
  `AiModel.Model<"openai", LanguageModel.LanguageModel, OpenAiClient>`; `layer`
  at `:720-724`.
- `@effect/ai-openai/src/OpenAiLanguageModel.ts:662,622,788`; Anthropic
  `:728,701,839`; OpenRouter `:562,527,641`. Same shape in all four.

**Per-call recipe** (the pattern P0 uses):

```ts
const client = yield* OpenAiClient.make({
  apiKey: Redacted.make(plaintextKey),   // decrypted for this call only
  apiUrl,                                 // the AI's connection base URL
});
const model = yield* OpenAiLanguageModel.make({ model, config }).pipe(
  Effect.provideService(OpenAiClient, client),
);
const response = yield* model.generateText({ prompt, toolkit }).pipe(
  Effect.timeout(timeoutMs),
);
```

Because `make` is an `Effect`, the key never has to live in a global layer, and
the plaintext goes out of scope when the effect finishes. That is the same trust
boundary as today (`connections/service.ts:183-214`): the plaintext exists only
inside the server process for one call.

### 3.3 Tool definitions and toolkits

- `Tool.make(name, { description, parameters, success, failure, failureMode })`
  at `effect/src/ai/Tool.ts:1264-1338`; `parameters` is an Effect `Schema`
  (`:1279`), `success` the handler result schema (`:1283`), `failureMode`
  `"error"` (default) or `"return"` (`:1289-1300`). The `Tool` interface is
  `:209-252`.
- `Tool.dynamic(name, { parameters, success })` at `:1387+` accepts **either** an
  Effect Schema **or** a raw JSON Schema (`:480-500`, type `:506-534`). This is
  the escape hatch for our tool set, which currently carries JSON-schema-ish
  definitions (`apps/server/src/agents/tools.ts`), and for MCP tools later.
- `Toolkit.make(...tools)` at `effect/src/ai/Toolkit.ts:574-576`; handlers via
  `Toolkit.of(handlers)` (`:88`) or `toolkit.toLayer(build)` (`:96-104`).
- Our existing tools are hand-validated in `tool-exec.ts`; the plan keeps our
  executor and exposes each tool to Effect AI as a `Tool.dynamic` with a
  pass-through handler (see §5.2).

### 3.4 Tool-call results

- A response's tool calls and results: `GenerateTextResponse.toolCalls`
  (`effect/src/ai/LanguageModel.ts:440-442`) and `.toolResults`
  (`:447-449`). Each `ToolResultPart` carries `name`, `id`, `result`, and
  `isFailure` (`effect/src/ai/Response.ts:1666-1717`), which maps cleanly onto
  our `ToolExecution { content }` result.
- Handler-level failures: `Tool.HandlerResult` exposes `encodedResult` and
  `isFailure` (`effect/src/ai/Tool.ts:1004-1019`).

### 3.5 Streaming

- `LanguageModel.streamText({ prompt, toolkit })` returns a
  `Stream<Response.StreamPart>` (`effect/src/ai/LanguageModel.ts:179-214`);
  `GenerateTextOptions.toolkit` (`:279`) and `toolChoice` (`:296`) apply.
- Stream part types: `Response.StreamPart` (`effect/src/ai/Response.ts:336-357`)
  includes `TextDeltaPart` (`:767`), `ToolCallParts` (`:1440`),
  `ToolResultParts`, and `FinishPart` (`:2498`). The docs example filters
  `part.type === "text-delta"` and maps `part.delta`
  (`effect/ai-docs/src/71_ai/10_language-model.ts:124-133`).
- The compat client requests usage on the stream with
  `stream_options: { include_usage: true }`
  (`@effect/ai-openai-compat/src/OpenAiClient.ts:236-243`), so token counts
  arrive on the stream too.

### 3.6 Token usage

- `Response.Usage` (`effect/src/ai/Response.ts:2425-2464`): `inputTokens`
  (`uncached`, `total`, `cacheRead`, `cacheWrite`) and `outputTokens`
  (`total`, `text`, `reasoning`).
- `GenerateTextResponse.usage` (`effect/src/ai/LanguageModel.ts:462-480`) reads
  it from the `finish` part; `finishReason` (`:454-457`) is `"stop"`,
  `"length"`, `"tool-calls"`, etc. (`Response.ts:2557-2568`).
- Mapping to the provider fields we care about:
  - OpenAI: `cached_tokens` → `cacheRead`, `input_tokens - cached_tokens` →
    `uncached` (`@effect/ai-openai/src/OpenAiLanguageModel.ts:3349-3385`,
    `:3368`).
  - Anthropic: `cache_read_input_tokens` → `cacheRead`,
    `cache_creation_input_tokens` → `cacheWrite`
    (`@effect/ai-anthropic/src/AnthropicLanguageModel.ts:2117-2128` and the
    streaming path `:2351-2353`).
  These are exactly the columns the new `ai_usage` table stores (§5.3).

### 3.7 Errors

- `AiError` is a `Schema.Error` with `module`, `method`, and a tagged `reason`
  (`effect/src/ai/AiError.ts:1640-1669`); `reason` is the union `AiErrorReason`
  (`:1515-1533`). `isRetryable`/`retryAfter` delegate to the reason
  (`:1657-1669`).
- Reasons that matter for us: `RateLimitError` (retryable, `:507-530`),
  `QuotaExhaustedError` (needs user action, `:561-583`), `AuthenticationError`
  with `kind` `InvalidKey|ExpiredKey|MissingKey|InsufficientPermissions|Unknown`
  (`:624-647`), `InvalidRequestError` (`:744-768`), `InternalProviderError`
  (retryable 5xx, `:804-826`), `NetworkError`
  (`reason` `TransportError|EncodeError|InvalidUrlError`, `:149-172`).
- `AiError.reasonFromHttpStatus({ status })` maps 400/401/403/429/5xx to those
  reasons (`:1790-1804`) — the same mapping our `failure-class.ts:39-63` does by
  hand. P0 replaces the string matching in `failure-class.ts` with a match on
  `error.reason._tag`, keeping the same five public reply texts (they are user
  facing and must not change).

### 3.8 Timeouts and cancellation

Effect cancellation is cooperative interruption, so `Effect.timeout`/`timeoutOrElse`
cancels the in-flight call. The HTTP layer wires the fiber's signal straight into
`fetch`, which aborts the socket:

- `effect/src/http/FetchHttpClient.ts:56-76` — `HttpClient.make((request, url,
  signal, fiber) => … fetch(url, { …, signal }))`.

So the current `AbortController` + deadline dance in
`tool-loop.ts:232-332` is replaced by `Effect.timeoutOrElse`; nothing else is
needed for cancellation, including for streams.

## 4. Provider mapping

| Our provider (`connections/providers.ts` id) | Effect AI package | Constructor | Base URL (official) |
|---|---|---|---|
| `openai` | `@effect/ai-openai` | `OpenAiClient.make` (`OpenAiClient.ts:197`), `/responses` (`:248`) | `https://api.openai.com/v1` (default) |
| `anthropic` | `@effect/ai-anthropic` | `AnthropicClient.make` (`:228`), `/v1/messages` (`:364`) | `https://api.anthropic.com` (default) |
| `openrouter` | `@effect/ai-openrouter` | `OpenRouterClient.make` (`:175`), `/chat/completions` (`:284`) | `https://openrouter.ai/api/v1` (default) |
| `deepseek` | `@effect/ai-openai-compat` | `OpenAiClient.make` (`:141`) | `https://api.deepseek.com` |
| `xai` | `@effect/ai-openai-compat` | same | `https://api.x.ai/v1` |
| `google` | `@effect/ai-openai-compat` | same | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| custom (T-1396) | `@effect/ai-openai-compat` | same | the owner's `provider_connections.base_url` |

Official base URLs (checked 2026-10-14):

- DeepSeek: `https://api.deepseek.com` (the OpenAI-compatible `base_url`; the
  docs note `https://api.deepseek.com/v1` also works) —
  <https://api-docs.deepseek.com/> and
  <https://api-docs.deepseek.com/api/list-models/>.
- xAI: `https://api.x.ai/v1` —
  <https://docs.x.ai/developers/rest-api-reference/inference> and
  <https://docs.x.ai/overview>.
- Google Gemini, OpenAI compatibility:
  `https://generativelanguage.googleapis.com/v1beta/openai/` —
  <https://ai.google.dev/gemini-api/docs/openai>.

The compat client appends `/chat/completions` to the `apiUrl`
(`@effect/ai-openai-compat/src/OpenAiClient.ts:190,236`), so `https://api.deepseek.com`
becomes `https://api.deepseek.com/chat/completions`, matching DeepSeek's own
curl example.

The T-1396 custom provider already plans `provider_connections.base_url` plus an
SSRF guard; under this plan the base URL is simply the per-call `apiUrl`, so
T-1396 and P0 share one code path (`work/T-1396-openai-compatible-provider.md`).

### Gaps to call out

1. **`effect` must be bumped to `^4.0.4`** (peer of all four packages, §3.0).
2. **OpenAI goes through the `/responses` API**, not chat completions, in
   `@effect/ai-openai`. Our prompts are chat-shaped; Effect AI normalises that
   inside the package (we pass `Prompt`/`Toolkit`, not wire JSON), so this is
   transparent — but it means OpenAI tool-calling behaviour comes from the
   Responses mapping, not a chat-completions passthrough.
3. **Compat endpoints and tools/streaming:** the compat package sends
   `tool_choice`, `tools` and `stream: true` in the standard chat-completions
   shape (`OpenAiClient.ts:190,236`; tools assembled in
   `OpenAiLanguageModel.ts:635-652`). DeepSeek, xAI and Gemini all document
   chat-completions function calling, but each has quirks (DeepSeek uses
   `thinking`/`reasoning_effort`; Gemini's compat endpoint is beta). The compat
   `Config` service is an open record (`[x: string]: unknown`,
   `OpenAiLanguageModel.ts:99-118`), so provider-specific fields can be passed
   without a code change in the package.
4. **`stream_options.include_usage` is always sent** by the compat client
   (`OpenAiClient.ts:240-242`). A compat server that rejects unknown
   `stream_options` would 400 on *every streaming call* or drop usage. Mitigation:
   feature-detect in the P0 spike, and fall back to a non-streamed call (or drop
   the flag via `transformClient`) for such providers.
5. **Anthropic prompt caching is supported** through the message-level
   `cacheControl` (`@effect/ai-anthropic/src/AnthropicLanguageModel.ts:1007,139`),
   and the cache tokens are reported (§3.6). Openrouter/OpenAI cache
   automatically; the perf rules in `agent-system.md` §2.5 (stable prefix,
   append-only context) are what make it pay off.

## 5. The new design in our server

### 5.1 `ModelClient` (new: `apps/server/src/ai/model-client.ts` + `ai/providers.ts`)

`ModelClient` is an Effect service, built per call so the key/base URL are local:

```ts
interface ModelCallInput {
  connection: AiConnection;          // provider, baseUrl (optional), plaintext key
  model: string;
  messages: ModelRequestMessage[];   // our existing wire shape, unchanged
  tools?: ChatToolDefinition[];      // our existing tool definitions
  onDelta?: (textSoFar: string) => void;
  maxTokens?: number;
}

interface ModelCallResult {
  content: string | null;
  toolCalls: ChatToolCall[];         // id, name, argsJson — unchanged
  finishReason?: string;
  usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens };
}

interface ModelClient {
  chat(input: ModelCallInput): Effect.Effect<ModelCallResult, AiError.AiError>;
}
```

- `ai/providers.ts` holds the provider→constructor map (§4): given `provider`
  and optional `baseUrl`, it returns the right client and model layer.
- `model-client.ts` converts our `ModelRequestMessage[]` into `Prompt` (system /
  user / assistant / tool) — `Prompt.make` accepts an iterable of encoded
  messages (`effect/src/ai/Prompt.ts:1993-1996,2061-2075`,
  `fromMessages:2102`) — converts our tools into `Tool.dynamic` entries
  (`Tool.ts:1387`), and maps `AiError` to the existing `ChatCompletionError`
  seam so `failure-class.ts` and every reply text stay unchanged.
- **Keep our message and tool shapes.** Moving the whole loop to `effect/ai`
  `Prompt`/`Tool` types directly is the right end state (§6 P1/P2), but it would
  touch `context.ts`, `tools.ts`, `tool-exec.ts` and every gateway turn at once.
  P0 keeps our shapes and only swaps the transport, which is why it fits in one
  or two tasks. The conversion lives in one file and is deleted when the loop
  migrates.
- **Cancellation** is `Effect.timeoutOrElse` (§3.8); the async wrapper keeps an
  `AbortSignal` so `requestCompletion`'s callers do not change signature.

### 5.2 How the agent loop switches

- `agents/tool-loop.ts`: replace the body of `requestCompletion` with a call to
  `ModelClient.chat`; delete the SSE parser (`agents/stream.ts`, only used there:
  `tool-loop.ts:3`) and the hand-rolled `fetch`/SSE/retry code
  (`tool-loop.ts:174-365`). The public types (`ModelRequestMessage`,
  `ChatToolCall`, `ChatCompletionResult`, `ChatCompletionError`) stay, so
  `dm-tool-turn.ts`, `group-turn.ts` and `tool-exec.ts` change little.
- Provider errors map through `classifyFailure` (`failure-class.ts:39-63`) from
  `AiError.reason._tag`; the reply texts in `tool-exec.ts`/`dm-turn.ts` stay
  byte-for-byte (they are user facing).
- `dm-turn.ts`, `dm-tool-turn.ts`, `group-turn.ts`: replace `baseUrl` +
  `virtualKey` with the AI's connection (`provider`, `baseUrl`, decrypted key).
  `reply.ts` drops the `LITELLM_CHAT_TIMEOUT_MS` re-export name (rename to
  `MODEL_CHAT_TIMEOUT_MS`).
- Gateway turns (`gateway/dm-turn.ts:178-215`,
  `gateway/group-turn-body.ts:109-145`) load the **connection** and decrypt the
  **owner's provider key** for the call instead of loading
  `llm_virtual_keys.encrypted_key`. The key is a local, is named as a redaction
  secret for the turn, and is never logged (same rule as today).

### 5.3 Usage and cost (new table)

New table, written after every model call (success or failure, when usage is
present):

```sql
CREATE TABLE ai_usage (
  ai_id         text        NOT NULL REFERENCES ais(id) ON DELETE CASCADE,
  day           date        NOT NULL,
  input_tokens      bigint  NOT NULL DEFAULT 0,   -- uncached
  output_tokens     bigint  NOT NULL DEFAULT 0,
  cached_tokens     bigint  NOT NULL DEFAULT 0,   -- cacheRead
  cache_write_tokens bigint NOT NULL DEFAULT 0,
  cost_usd      numeric(12,6) NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ai_id, day)
);
```

- `cost_usd` is computed from the prices of the models.dev catalog
  (`work/T-1395-models-dev-catalog.md`; its file
  `apps/server/src/ai/catalog.ts` is **not merged yet** as of this audit —
  name it as the source, and if T-1395 has not landed, a tiny price map inside
  the cost module is the fallback). Pricing fields used: input (uncached),
  output, and cache read/write.
- The write is a single `INSERT … ON CONFLICT (ai_id, day) DO UPDATE SET
  input_tokens = input_tokens + EXCLUDED.input_tokens, …`, so it is atomic per
  call and safe under concurrency.
- `ais/usage.ts` stops reading LiteLLM (`getKeyInfo`) and instead sums
  `ai_usage`; `ai_daily_spend` (the baseline table, `0005:1-24`) is dropped once
  nothing reads it.
- The contract shape `AiUsage` (`packages/api-contract/src/ais.ts:98-105`) and
  the web block (`AiUsageSection.tsx:40-50`) keep their shape so the UI does not
  change in the same task.
- Retry/order: tokens are counted slightly differently from LiteLLM's batched
  spend, so the derived daily number is now exact rather than lagging.

### 5.4 Budgets (owner-set only)

- **No default limit** (Julio's decision). `ai_limits` stays as the place an
  owner sets `per_day_usd` / `per_month_usd`; unset means unlimited.
- The check runs **before each model call** in the loop
  (`gateway/budget.ts:78-123,184-206`): read today's `ai_usage` sum for the AI,
  compare to the limit, send the fixed notice and skip the turn when reached.
  The 80% warnings (`:130-177`) read the same sum. `ai_daily_spend` baselines,
  the LiteLLM failure-open path and the "soft limit" comments
  (`ais/usage.ts:46-60`) disappear; when the usage read fails, the turn still
  fails open exactly as today.
- `provisioning.ts:201-242` no longer pushes the cap to a virtual key; the cap
  is only a row in `ai_limits`.

### 5.5 Provisioning without LiteLLM

- **Keeps:** the XMPP account and room setup, the avatar, and the AI row with its
  `provider_connection_id` + `model` (`ais/provisioning.ts`,
  `provisioning-xmpp.ts`). Connection validation (`findOwnedConnection`,
  `isLlmProvider`) stays.
- **Drops:** `addModel`/`/model/new` (`provisioning.ts:104`,
  `provisioning-keys.ts:54,230`), `generateKey`/`updateKey`/`revokeKey`
  (`provisioning.ts:111,205`, `provisioning-xmpp.ts:56,163`),
  `buildUserModelEntry`/`modelNameForAi`/`litellmModelFor`
  (`ai/model-entry.ts`, `ais/litellm-model.ts`), and the
  `llm_virtual_keys` writes (`provisioning.ts:123,242`,
  `provisioning-xmpp.ts:101`).
- Changing an AI's model becomes: update `ais.model` (and
  `provider_connection_id`); nothing to register remotely.
- `isLlmProvider` (the provider allow-list check) moves next to the new provider
  map in `ai/providers.ts` instead of `ais/litellm-model.ts`.

### 5.6 The listener model

The listener is a platform-paid feature today: `main.ts:472-477` passes
`LISTENER_MODEL` + `LITELLM_MASTER_KEY` and `gateway/listener.ts:185` calls the
model with the master key; `config.ts:257-261` documents this. With no gateway
there is no platform key, so:

- **Recommended P0:** turn the listener off unless an owner has explicitly
  attached a connection, i.e. make the listener use an AI's own connection (the
  `listener-delegation-plan.md` direction) instead of a server-wide model.
  `LISTENER_MODEL` and the listener's `virtualKey` are removed.
- **Fallback:** keep `LISTENER_ENABLED` but require the owner to pick an AI to
  delegate to; with none, stay off with the existing warning.

Either way `LISTENER_MODEL` and `LITELLM_MASTER_KEY` leave `config.ts`.

### 5.7 Removing `llm_virtual_keys` and `LITELLM_*`

Delete: `ai/litellm-client.ts`, `ai/litellm-schemas.ts`, `ai/litellm-types.ts`,
`ai/model-entry.ts`; the `LITELLM_BASE_URL`/`LITELLM_MASTER_KEY` config
(`config.ts:123-131,413-422`), the `logger.ts:27` redaction, the compose defaults
(`deploy/coolify/docker-compose.app.yml:181,184`,
`deploy/coolify/docker-compose.yml:155,158`, `deploy/docker-compose.yml:163,166`),
`.env.example` blocks (`deploy/.env.example:81-89`, `apps/server/.env.example:52-53`,
`infra/.env.example:21-46`), `infra/litellm/config.yaml`, the dev smoke check
(`packages/devtools/src/smoke.ts:23,29,39,45,121-124`), the `AisConfigured`
comment (`packages/api-contract/src/middleware.ts:178-186`) and the stale
comments (`api-contract/src/ais.ts:99`, `web/src/lib/api/ais.ts:173`,
`ais/status.ts:9`, `connections/smoke-client.ts:2`).

**Migration, expand/contract** (AGENTS.md): add `ai_usage` first and keep
`llm_virtual_keys` while the previous release still reads it. Drop
`llm_virtual_keys` (and `ai_daily_spend`) in a **later** release, after the old
server is gone. Every new `.sql` starts with `SET lock_timeout = '5s';`. The
`ai_usage` migration takes the next free number at build time (T-1396 is
planned to take 0055).

## 6. The task split

Ordered, each ~<=600 changed lines and every file <=400 lines. "a" files are the
first task that makes a DM answer end to end against a fake OpenAI-compatible
HTTP server.

### Task 1 — `ModelClient` + a DM turn answers end to end (fake provider)
- **Files:** `pnpm-workspace.yaml` (bump `effect` to `^4.0.4`; add the four
  provider packages to the catalog), `apps/server/package.json` (deps), new
  `apps/server/src/ai/model-client.ts`, new `apps/server/src/ai/providers.ts`,
  `apps/server/src/agents/tool-loop.ts` (delegate `requestCompletion` to
  `ModelClient`), delete `apps/server/src/agents/stream.ts`,
  `apps/server/src/agents/dm-turn.ts`, `apps/server/src/agents/dm-tool-turn.ts`,
  `apps/server/src/agents/reply.ts`, `apps/server/src/agents/gateway/dm-turn.ts`,
  `apps/server/src/agents/gateway/contracts.ts`,
  `apps/server/src/agents/gateway/db.ts` (load connection, not virtual key),
  `apps/server/src/agents/tool-exec.ts` (failure mapping from `AiError`).
- **Anchors:** `tool-loop.ts:218-358` (replace), `tool-loop.ts:3` (drop stream
  import), `gateway/dm-turn.ts:178-215` (connection + decrypt),
  `gateway/contracts.ts:5,23-32` (drop `litellm`/`litellmBaseUrl`, add
  connection deps).
- **Deletes:** `agents/stream.ts`, the hand-rolled fetch/SSE/retry in
  `tool-loop.ts:174-365`.
- **Tests:** new `apps/server/src/agents/dm-turn.fake-provider.test.ts` — start a
  local Node HTTP server that speaks OpenAI-compatible chat completions (one
  tool call round, then a final text), point a fake connection at it, run
  `runDmTurn`, assert the DM text, the tool execution, and usage in the result.
  A focused `apps/server/src/ai/model-client.test.ts` for message/tool
  conversion and `AiError` mapping. No real network, no real keys.

### Task 2 — group turns and the listener on `ModelClient`
- **Files:** `apps/server/src/agents/group-turn.ts`,
  `apps/server/src/agents/gateway/group-turn.ts`,
  `apps/server/src/agents/gateway/group-turn-body.ts`,
  `apps/server/src/agents/gateway/listener.ts`,
  `apps/server/src/agents/gateway.ts`,
  `apps/server/src/agents/gateway/lifecycle.ts`,
  `apps/server/src/main.ts` (listener off / owner-delegated).
- **Anchors:** `group-turn.ts:38,152,189`,
  `group-turn-body.ts:109-145,279`, `listener.ts:185`, `gateway.ts:66,136`,
  `lifecycle.ts:137-138`, `main.ts:472-483`.
- **Tests:** extend the fake-provider harness with one group-turn test (a room
  message to an @-mentioned AI).

### Task 3 — usage table and cost accounting
- **Files:** new `apps/server/drizzle/00NN_ai_usage.sql` (next free number),
  `apps/server/src/ai/cost.ts` (new; models.dev prices),
  `apps/server/src/ais/usage.ts` (sum `ai_usage`),
  `apps/server/src/ais/queries.ts` (drop the `llm_virtual_keys` join),
  `apps/server/src/ais/api.ts`, `apps/server/src/agents/gateway/budget.ts`
  (write usage; keep the read until Task 4), `packages/api-contract/src/ais.ts`
  (optional richer `AiUsage`), `apps/web/src/components/ais/AiUsageSection.tsx`.
- **Anchors:** `ais/usage.ts:61-166`, `queries.ts:119-135,189-190`,
  `ai/litellm-types.ts:3` (drop `DEFAULT_LITELLM_BASE_URL` usage here).
- **Deletes:** the `getKeyInfo` spend read and the `ai_daily_spend` baseline
  logic.
- **Tests:** `apps/server/src/ais/usage.test.ts` — a call writes one `ai_usage`
  row with the four counters and a cost, and a second call adds to it
  (accounting, money ⇒ test allowed).

### Task 4 — budgets, owner-set only
- **Files:** `apps/server/src/agents/gateway/budget.ts` (read the `ai_usage`
  sum), `apps/server/src/ais/usage.ts` (final shape),
  `apps/server/src/ais/provisioning.ts` (stop pushing caps).
- **Anchors:** `budget.ts:59-123,130-177,184-206`, `provisioning.ts:201-242`.
- **Deletes:** the "LiteLLM hard cap" budget branch in
  `failure-class.ts:37-43`; `ai_daily_spend`.
- **Tests:** a budget test in `budget`/`usage` — limit reached skips the turn and
  sends the notice once per AI per chat per day; no limit means unlimited.

### Task 5 — provisioning without LiteLLM
- **Files:** `apps/server/src/ais/provisioning.ts`,
  `apps/server/src/ais/provisioning-keys.ts`,
  `apps/server/src/ais/provisioning-xmpp.ts`,
  `apps/server/src/ais/litellm-model.ts` (move `isLlmProvider` to
  `ai/providers.ts`, delete the rest), delete `apps/server/src/ai/model-entry.ts`.
- **Anchors:** the provisioning rows in §2.3.
- **Deletes:** virtual keys, `/model/new`, the `llm_virtual_keys` writes.
- **Tests:** the AI create/change/delete tests already cover the transaction;
  update them to the no-gateway path (no new test needed unless the delete
  ordering changes).

### Task 6 — remove `llm_virtual_keys` and the `LITELLM_*` env
- **Files:** new contract migration `…_drop_llm_virtual_keys.sql` (drop
  `llm_virtual_keys` and `ai_daily_spend`), `apps/server/src/config.ts`,
  `apps/server/src/logger.ts`, `apps/server/src/agents/gateway/contracts.ts`,
  `apps/server/src/app.ts`, `apps/server/src/leader/start.ts`,
  `apps/server/src/main.ts`, `apps/server/src/machines/hub.ts`,
  `deploy/coolify/docker-compose.app.yml`,
  `deploy/coolify/docker-compose.yml`, `deploy/docker-compose.yml`,
  `deploy/.env.example`, `apps/server/.env.example`, `infra/.env.example`,
  delete `infra/litellm/config.yaml`,
  `packages/devtools/src/smoke.ts`, `packages/api-contract/src/ais.ts`,
  `packages/api-contract/src/middleware.ts`, `apps/web/src/lib/api/ais.ts`,
  delete `apps/server/src/ai/litellm-client.ts`, `litellm-schemas.ts`,
  `litellm-types.ts`.
- **Anchors:** the compose/env/migration rows in §2.6-2.7.
- **Tests:** the 503 gate (`AisConfigured`) test flips to the new "configured"
  definition; the devtools smoke drops the LiteLLM check.

Tests are deliberately few: usage accounting (Task 3), the budget check
(Task 4), and the fake-provider round trip with a tool call (Task 1). Everything
else is covered by the existing turn/gateway tests.

## 7. Live check (how the lead verifies after deploy)

1. Julio adds his provider key in the app's **Connections** screen
   (`apps/web` → Connections; the key is sealed by
   `connections/crypto.ts`). **The lead never handles the key.**
2. Create or open an AI pointed at that connection and model (T-1394/T-1396 UI).
3. DM the AI a plain question → expect a normal reply (the P0 acceptance).
4. DM a tool-triggering question (e.g. a persona change or `request_action`) →
   expect one tool round and a final reply, no progress spam.
5. Open the AI's settings → the Usage block shows today's tokens/cost, and with
   a limit set the next turn over the cap sends the fixed limit notice.
6. Check logs: no `LITELLM_*` variables, no provider key in any line
   (`logger.ts` redaction paths), and `GET /health` stays up.

## 8. Risks and open questions

- **`effect` 4.0.2 → 4.0.4 bump.** All four provider packages peer on `^4.0.4`.
  The bump may ripple through every `effect/*` import (`@effect/atom-react`,
  `@effect/sql-*` are at 4.0.2 in `pnpm-workspace.yaml:6`); verify versions
  align to one 4.0.x before starting Task 1. **Open question for the lead:** do
  we bump the whole 4.0.x set together, or only `effect`?
- **Fake-provider fidelity.** A fake server proves our loop and shapes, not a
  provider's real quirks (tool-call streaming, `stream_options`, reasoning
  fields). A short spike against one real provider (Julio's key, his choice) is
  worth folding into Task 1's live check.
- **Compat `stream_options`.** Some OpenAI-compatible servers reject it
  (§4 gap 4). Decide whether to always send it, or to detect the provider.
- **OpenAI via `/responses`.** Different API from chat completions; confirm
  tool-call and streaming behaviour matches our expectations during Task 1.
- **Migrations under parallel work.** T-1395 (catalog, in progress) and T-1396
  (custom provider, planned, migration 0055) both touch this area. Task 3's
  `ai_usage` migration must take the next free number at the time it lands, and
  must not rename or drop `llm_virtual_keys` while the old release still runs.
- **Listener.** Who pays for it is a product decision (§5.6). Defaulting it off
  is the safe P0; delegating to an owner's AI is the design direction.
- **Cost precision.** models.dev prices change; the `ai_usage` row stores tokens
  plus the cost computed at call time, so a later price change does not rewrite
  history. Confirm with Julio whether cost should be computed from a snapshot at
  call time (recommended) or re-derived.

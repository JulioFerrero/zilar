---
id: T-1399
title: "P0 task 1: every AI model call goes through a new Effect AI ModelClient using the AI's own provider connection (owner key decrypted per call); no LiteLLM in the turn path; a DM to an AI answers end to end against a fake OpenAI-compatible server"
status: merged
milestone: M5
branch: task/T-1399-model-client-effect-ai
model: auto
effort: default
depends_on: []
estimate: 1 day
---

# T-1399: ModelClient on Effect AI

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-14: model calls move into our server through **Effect AI**, and LiteLLM goes away (`docs/design/agent-system.md` §2.1 and §7). Production has no LiteLLM, so no AI can answer live.

**The plan is `docs/audit/effect-ai-plan.md`.** Read §3 (the Effect AI API, with source lines), §4 (provider mapping), §5.1-5.2 (the design) and §6 "Task 1". This task is that Task 1, widened to every model-call site, because changing the call input changes all of them at once.

### Facts (the lead checked them on main, 2026-10-14)
- **All model calls go through `requestCompletion`** (`apps/server/src/agents/tool-loop.ts:316`). Its input `CompleteChatInput` (`:121-133`) carries `baseUrl`, `virtualKey` and `model`, and it POSTs to `${baseUrl}/chat/completions` (`:223`). The SSE parser is `apps/server/src/agents/stream.ts`. `tool-loop.ts` is exactly 400 lines.
- **Callers:**
  - `dm-tool-turn.ts:120,326`;
  - `dm-turn.ts:36-37` (`completeChat`);
  - `group-turn.ts:200,222,348`;
  - `gateway/memory.ts:126` (compaction, through `completeChat`);
  - `gateway/listener.ts:183-186` (`scoreRoom`).
- **The gateway turns** register a LiteLLM model and load the virtual key:
  - DM: `gateway/dm-turn.ts:176-183` (`ensureAiModel`, then `loadEncryptedVirtualKey` from `gateway/db.ts:258`, then `cipher.decrypt`). The model name is `modelNameForAi(session.aiId)` (`gateway/dm-turn.ts:271`, from `apps/server/src/ai/model-entry.ts`).
  - Group: `gateway/group-turn-body.ts:107` and `:280`.
  - Memory: `gateway/memory.ts:13,41,129`.
- **The gateway refuses to start without LiteLLM:** `gateway/lifecycle.ts:136-139` checks `deps.litellm === undefined || deps.cipher === undefined`.
- **The listener** is server-paid with the LiteLLM master key (`apps/server/src/main.ts:471-483`).
- **AIs point at the owner's connection:** `ais.provider_connection_id` and `ais.model` (`apps/server/src/ais/queries.ts:21,119,180`).
  - `provider_connections` has `id`, `owner`, `provider`, `encrypted_key` and `status`.
  - The decrypt helper is `apps/server/src/connections/service.ts:187` (`decryptForGatewayUseEffect`).
- **Effect** is `^4.0.2` (`pnpm-workspace.yaml:11`); `@effect/atom-react` is `4.0.2` (`:6`). The provider packages are on `4.0.4` and need `effect ^4.0.4`.

### What to build
1. **Dependencies.**
   - Bump `effect` to `^4.0.4` and `@effect/atom-react` to `4.0.4` in `pnpm-workspace.yaml`. Check any other `@effect/*` in the repo's `package.json` files and move them to the same 4.0.4.
   - Add to the catalog, and to `apps/server/package.json`: `@effect/ai-openai`, `@effect/ai-anthropic`, `@effect/ai-openrouter` and `@effect/ai-openai-compat`, all `4.0.4`.
2. **`apps/server/src/ai/providers.ts`** (new): a map from our provider id to the client constructor and base URL, as the plan's §4 table gives it:
   - openai → ai-openai;
   - anthropic → ai-anthropic;
   - openrouter → ai-openrouter;
   - deepseek `https://api.deepseek.com`, xai `https://api.x.ai/v1` and google `https://generativelanguage.googleapis.com/v1beta/openai/` → ai-openai-compat.

   Also an `apiUrl` override, so a test (and T-1396 later) can point any provider at another URL.
3. **`apps/server/src/ai/model-client.ts`** (new), following the plan's §5.1:
   - `chat(input)` takes a `ModelTarget { provider, apiKey, model, apiUrl? }`, our `ModelRequestMessage[]`, our tool definitions, `onDelta`, `maxTokens` and a timeout;
   - it builds the client **per call** with `Redacted` (plan §3.2), converts messages to `Prompt` and tools to `Tool.dynamic` (§3.3), and streams when `onDelta` is given (§3.5);
   - it returns `{ content, toolCalls, finishReason, usage }`;
   - it maps `AiError` reasons to our `ChatCompletionError` (§3.7), so `failure-class.ts` and **every user-facing reply text stay byte for byte**.
   - Keep each file at most 400 lines; split the converters into `apps/server/src/ai/model-prompt.ts` if needed.
4. **Swap the transport:**
   - In `CompleteChatInput`, replace `baseUrl` + `virtualKey` + `model` with `target: ModelTarget`.
   - `requestCompletion` calls `ModelClient.chat`. Delete the hand-rolled fetch, SSE and retry code and `agents/stream.ts`; keep a retry only if `effect/ai` doesn't already retry (say which in the Report).
   - Rename `LITELLM_CHAT_TIMEOUT_MS` to `MODEL_CHAT_TIMEOUT_MS`.
   - Update every caller listed above.
5. **The gateway loads the AI's own connection.**
   - Add `loadModelTarget(db, cipher, aiId)` in `apps/server/src/agents/gateway/db.ts`:
     ```
     SELECT ais.model, pc.provider, pc.encrypted_key
     FROM ais JOIN provider_connections pc
       ON pc.id = ais.provider_connection_id AND pc.owner = ais.owner
     WHERE ais.id = $aiId AND pc.status = 'active'
     ```
     The owner scoping is required (pre-review nit). It decrypts in memory and returns a `ModelTarget`, or `null`. If `db.ts` would pass 400 lines, put it in a new `gateway/model-target.ts`.
   - Use it in the DM, group and memory paths instead of `ensureAiModel`, `loadEncryptedVirtualKey` and `modelNameForAi`.
   - **With no target** (no connection, or connection inactive): skip the turn with the existing "can't reach my model" style reply. Don't throw.
   - The decrypted key is added to the turn's redaction secrets and never logged.
6. **The gateway starts without LiteLLM:** `gateway/lifecycle.ts:136-139` now needs only the cipher; keep the warning text accurate. Budget reads that use `deps.litellm` stay as they are (they already fail open when it's absent; Tasks 3-4 replace them).
7. **The listener is off in P0** (lead decision: there is no platform key now).
   - In `main.ts`, never build `gatewayListener`; if `LISTENER_ENABLED` is on, log one warning that the listener is off until AIs can pay for it.
   - Adapt `listener.ts` and `score.ts` types to `ModelTarget` so they still compile; don't delete them.
8. **Out of scope:** provisioning (`apps/server/src/ais/provisioning*.ts`), the AIs API gate, usage, budgets, migrations, env and compose. Those are T-1400 and later tasks. Don't delete `litellm-client.ts`, `model-entry.ts` or `ensureAiModel`; only stop calling them from the turn path.

### Tests (message pipeline; keep them few)
- **`apps/server/src/agents/dm-turn.fake-provider.test.ts`** (new): start a local Node HTTP server that speaks OpenAI-compatible chat completions (streamed SSE):
  - the first response is one tool call; the second is the final text;
  - point a `ModelTarget` (`provider: 'deepseek'`, `apiUrl` = the fake server) at it and run the DM tool turn;
  - assert the reply text, that the tool ran, that the usage numbers came through, and that the API key arrived as `Authorization: Bearer …` at the fake server.
- **`apps/server/src/ai/model-client.test.ts`** (new): message and tool conversion; and one `AiError` → reply-text mapping each for 401 and 429.
- Update existing tests and harnesses that build `CompleteChatInput` or `virtualKey` (for example `gateway.test-harness.ts`) to the new shape. Don't add more tests.

### Read first
`AGENTS.md`, `docs/audit/effect-ai-plan.md`, the files above, `node_modules/.pnpm/effect@4.0.*/node_modules/effect/src/ai/LanguageModel.ts`, `Tool.ts`, `Prompt.ts`, `AiError.ts`, and the provider packages' `src/` after install.

### Allowed files
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `apps/*/package.json`, `packages/*/package.json`, `apps/server/src/ai/providers.ts`, `apps/server/src/ai/model-client.ts`, `apps/server/src/ai/model-client.test.ts`, `apps/server/src/ai/model-prompt.ts`, `apps/server/src/agents/*.ts`, `apps/server/src/agents/gateway/*.ts`, `apps/server/src/agents/listener/*.ts`, `apps/server/src/main.ts`, `work/T-1399-model-client-effect-ai.md`.

### Checks
```bash
pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/ai/model-client.test.ts --reporter=dot
pnpm gate
```

### Acceptance
- The gate passes; every file stays at most 400 lines.
- The fake-provider test shows a DM answered through Effect AI with one tool round.
- `git grep -n "chat/completions" apps/server/src` finds no hand-rolled call.
- Report: what `effect/ai` does about retries, and anything that differs from the plan.

---

## Report (written by the worker when done)

### What I did
- **Dependencies** (`pnpm-workspace.yaml`, `apps/server/package.json`): bumped `effect` to
  `^4.0.4` and `@effect/atom-react` to `4.0.4`; moved `@effect/platform-node`,
  `@effect/sql-pg` and `@effect/sql-pglite` from `4.0.2` to `4.0.4`; added
  `@effect/ai-openai`, `@effect/ai-anthropic`, `@effect/ai-openrouter` and
  `@effect/ai-openai-compat` at `4.0.4` to the catalog and to `apps/server`.
- **`apps/server/src/ai/providers.ts`** (new): the provider→client map from the plan's §4
  table (`openai`/`anthropic`/`openrouter` native packages; `deepseek`, `xai`, `google`
  through `ai-openai-compat` with their official base URLs), an `apiUrl` override, and
  `isModelProvider`. The client is built per call with `Redacted` (§3.2).
- **`apps/server/src/ai/model-prompt.ts`** (new): `ModelRequestMessage[]` → `Prompt`
  (assistant `tool_calls` → `tool-call` parts, `tool` messages → `tool-result` parts with
  the tool name recovered from the matching call) and our tool definitions →
  `Tool.dynamic` (raw JSON Schema) wrapped as a toolkit.
- **`apps/server/src/ai/model-client.ts`** (new): `ModelClient.chat` builds the model for
  the target, streams with `disableToolCallResolution` + `toolCallValidation: 'deferred'`,
  returns `{ content, toolCalls, finishReason, usage }`, and maps every `AiError` back to
  `ChatCompletionError(status, detail)` so `failure-class.ts` and every reply text are
  unchanged. `MODEL_CHAT_TIMEOUT_MS` (90 s) and the one retry live here.
- **Transport swap**: `tool-loop.ts` now only re-exports the loop's types/caps and calls
  `chat`; the hand-rolled fetch/SSE/retry and `agents/stream.ts` are gone. `CompleteChatInput`
  carries `target: ModelTarget`; `LITELLM_CHAT_TIMEOUT_MS` → `MODEL_CHAT_TIMEOUT_MS`.
  Updated `dm-turn.ts`, `dm-tool-turn.ts`, `group-turn.ts`, `reply.ts`, `listener/score.ts`.
- **The gateway loads the AI's own connection**: new
  `agents/gateway/model-target.ts` `loadModelTarget(db, cipher, aiId)` runs the owner-scoped
  query from the spec (`pc.owner = ais.owner`, `pc.status = 'active'`), validates the
  provider and decrypts the key in memory. DM, group and memory compaction now use it
  instead of `ensureAiModel` + `loadEncryptedVirtualKey` + `modelNameForAi`. The decrypted
  key is added to the turn's redaction secrets and never logged.
- **Gateway startup**: `lifecycle.ts` now needs only the cipher. `main.ts` never builds the
  listener and logs one warning when `LISTENER_ENABLED` is on; `listener.ts`/`score.ts`
  types take a `ModelTarget` and still compile.
- **Tests**: new `agents/dm-turn.fake-provider.test.ts` (a real local HTTP server speaking
  SSE: one tool round, then the final text; asserts the reply, the tool, the usage numbers
  and `Authorization: Bearer …`) and `ai/model-client.test.ts` (message/tool conversion;
  one `AiError` → reply-text mapping for 401 and 429). Updated `reply.test.ts`,
  `gateway.test-harness.ts` (SSE fakes; the fake connection is now `deepseek`) and the
  `secretsFor` parameter name in the gateway files.

### Commands and results
- `pnpm install` — done after the dependency bump; `pnpm-lock.yaml` updated.
- `pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts src/ai/model-client.test.ts --reporter=dot`
  → **2 files passed, 5 tests passed**.
- `pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot <file>` while working:
  `reply.test.ts` 7 passed; `gateway-group.test.ts` 13 passed; `gateway-drain.test.ts`
  1 passed; `main.test.ts` 1 passed; `context-edits.test.ts` 3 passed;
  `ai/model-client.test.ts` 4 passed; `dm-turn.fake-provider.test.ts` 1 passed.
- `pnpm gate` (from the repo root), final run:
  ```
  gate: 34 changed file(s) against main
  PASS  install (frozen)  (1.1s)
  PASS  format  (1.5s)
  PASS  lint  (0.6s)
  PASS  typecheck  (0.8s)
  PASS  effect  (0.8s)
  PASS  tests @zilar/server  (7.6s)
  scope: every changed file is inside the Allowed files
  migration: every added migration continues from the base
  GATE PASS
  ```
- `git grep -n "chat/completions" apps/server/src` → **no matches** (the compat package
  appends the path internally).

### Deviations from the spec / notes
1. **Every call streams.** The plan says "streams when `onDelta` is given"; I kept the old
   behaviour (every call streams, `stream_options.include_usage`) and let `onDelta` only
   decide whether deltas are reported. One transport path, and the fake SSE server (the
   fake-provider test and the existing gateway fakes) stays simple.
2. **Retries.** `effect/ai` does **not** retry: `AiError.isRetryable`/`retryAfter` are flags
   only, and no provider package installs a `Schedule`. I kept the old policy: one retry,
   2 s apart, only while nothing has streamed and only when 2 s of the deadline remain, for
   429, 5xx, and a refused/timed-out connection.
3. **Improvised tool calls.** `disableToolCallResolution: true` alone drops undeclared tool
   calls; adding `toolCallValidation: 'deferred'` keeps them (the group plain path and the
   tool-loop tests rely on the model being answered for tools it was not offered).
4. **No target** (no connection, or inactive): the DM turn sends the existing
   `TRANSIENT_FAILURE_REPLY` — the same sentence the old "no virtual key" path produced —
   and does not throw; the group turn throws the same internal error the old missing-key
   path did, which the existing handler turns into `GROUP_FAILURE_REPLY`. No new
   user-facing text was added.
5. **`onUsage` seam.** `DmTurnDeps`/`GroupTurnDeps`/`CompleteChatInput` gained an optional
   `onUsage` callback so the token counters Effect AI reports can be asserted (and T-1400
   can account for them). No caller is required to pass it.
6. **Removed** the now-unused `loadEncryptedVirtualKey` (and its row type) and
   `AgentGatewayDeps.litellmBaseUrl`. Kept `litellm?`, `masterKeyForRedaction`,
   `litellm-client.ts`, `model-entry.ts` and `ensureAiModel` — Task 6 removes them.
7. **Token cap**: passed as the provider's own field (`max_output_tokens` for
   OpenAI/compat, `max_tokens` for Anthropic/OpenRouter). OpenRouter's package does not map
   a cap field in its request builder, so its cap is best-effort.
8. The test harness now stores a `deepseek` connection (compat) so the shared SSE fakes
   decode; other `@effect/*` packages were moved to 4.0.4 as the spec asked.

### Open questions
- None blocking. The only judgement call is the always-stream choice (deviation 1).

### Round (fix pass, 2026-10-14)

Pre-review findings fixed, one commit each (only `apps/server/src/ai/model-client.ts`
and `apps/server/src/ai/model-client.test.ts` changed):

- **Finding 1 (should-fix)** `0108decab`: `chat` builds the timeout inside
  `Effect.suspend(attempt)`, so each attempt gets `deadline - Date.now()` instead of a
  window fixed once at construction. Test added: `chat > gives the retry only what is
  left of the deadline` (first fetch rejects, the retry hangs; asserts two calls and
  total elapsed under `timeoutMs + 1 s`). On the unfixed code the test fails with
  `elapsed 8020` vs the 7000 limit.
- **Finding 2 (should-fix)** `9e31c0d9f`: the `onDelta` wrapper that sets `streamed` is
  always installed, not only when the caller passes `onDelta`. Test added: `chat > does
  not retry a call that already streamed, even without onDelta` (an SSE body emits one
  text delta and then errors; asserts exactly one fetch call). On the unfixed code the
  test fails with `2 !== 1`. Note: on the final code a dropped stream maps through
  `InvalidOutputError`, which finding 3 already makes non-retryable, so this test also
  passes because of finding 3; it isolates finding 2 at its own commit (verified above).
- **Finding 3 (should-fix)** `87ac0abfb`: `statusOf` maps `ToolParameterValidationError`
  and `InvalidOutputError` to `200` (non-retryable), as the old bad-shape path did.
  Tests added: `chat > never retries a malformed tool-args chunk and fails as a provider
  error` (a real SSE chunk with `arguments: '{not json'`; asserts status 200 and one
  call) and `chatErrorFromAiError for SDK-side failures` (both reasons → 200 and the
  transient reply). Both fail on the unfixed code (`+0` vs `200`).
- **Nit 4** (OpenRouter cap claim in deviation 7): report-only, left as it is; no code
  changed.

Commands and results:

- `pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts
  src/ai/model-client.test.ts --reporter=dot` → **2 files passed, 9 tests passed**.
- `pnpm gate` (repo root): **GATE PASS** — install, format, lint, typecheck, effect,
  tests @zilar/server all PASS; `scope: every changed file is inside the Allowed files`;
  `migration: every added migration continues from the base`; 34 changed files.

### Round 2 (pre-review findings 1-3, 2026-10-14)

Findings fixed (PREREVIEW.md at HEAD cc9ff74), one commit each; only
`apps/server/src/ai/model-client.ts` and `apps/server/src/ai/model-client.test.ts`
changed:

- **Finding 1 (should-fix)** `detailOf` now keeps a `RateLimitError`'s provider
  message: it reads `reason.http.body` (`{"error":{"message":…}}` → the message,
  else the raw body) instead of the fixed `'rate limited'`, matching the old
  `errorDetail`. `QuotaExhaustedError` keeps its `'budget exhausted'` string on
  purpose (the reviewer's Note: the budget branch must win). Test added:
  `chatErrorFromAiError > keeps a 429 provider message in the detail instead of a
  fixed string` (detail is the provider message, status still 429). Fails on the
  unfixed code (detail `'rate limited'`).
- **Finding 2 (should-fix)** `statusOf`'s default now returns the reason's real
  `http.response.status` when it carries one (`UnknownError` and any other
  provider-package fallthrough), so an unmapped status (402, 418) is a
  non-retryable `provider_error` as the old transport had it, not a retried
  status 0. Tests added:
  `chatErrorFromAiError > maps a response-carrying unknown error to its real
  non-retryable status` (402 → transient reply) and
  `chat > does not retry an unmapped HTTP status and fails as a provider error`
  (a 402 JSON answer: rejects 402, exactly one fetch). Both fail on the unfixed
  code (status 0; the `chat` test also retries, 2 calls).
- **Finding 3 (should-fix)** documented the SDK normalization at
  `ModelCallResult.finishReason` (`length`/`stop` pass through,
  `tool_calls`/`function_call` → `tool-calls`, anything else → `unknown`; only
  `length` is read today). Doc-only, no behaviour change, no test.
- **Nit 4** left as it is (by design, and not in a line I changed).
- **Point 5** (OpenRouter cap) is report-only; no code changed.

Commands and results:

- `pnpm --filter @zilar/server exec vitest run src/agents/dm-turn.fake-provider.test.ts
  src/ai/model-client.test.ts --reporter=dot` → **2 files passed, 12 tests passed**.
- The same `model-client.test.ts` against the unfixed `model-client.ts` (HEAD) with
  the new tests → **3 failed, 8 passed** (the three tests above fail exactly as
  intended).
- `pnpm gate` (repo root): **GATE PASS** — install, format, lint, typecheck, effect,
  tests @zilar/server all PASS; `scope: every changed file is inside the Allowed files`;
  `migration: every added migration continues from the base`; 34 changed files.

### Disagreements
- **Finding 1's stated reply-text outcome.** The finding says a 429 whose body
  names a model now returns `RATE_LIMITED_REPLY` "instead of
  `MODEL_NOT_FOUND_REPLY`". Keeping the provider message cannot change that:
  `classifyFailure` checks `status === 429` (`failure-class.ts:47`) **before** the
  model/context patterns (`:50-53`), and the old transport also produced status 429
  for that response (old `tool-loop.ts` `CompletionHttpError` carried
  `response.status`), so the old reply was `RATE_LIMITED_REPLY` too. Letting
  model/context win over a 429 would be a new behaviour and would break the spec's
  "every user-facing reply text stay byte for byte", so I left `failure-class.ts`
  untouched. I did make the parity fix the reviewer asked for: `detail` keeps the
  provider body (it also lets a 429 body saying "budget" reach the budget branch,
  which reads the detail first).

## Review (written by Claude)
Lead, 2026-10-14: approved. Pre-review CLEAN after 2 auto rounds: per-attempt timeout, the stream flag always set, SDK shape errors not retryable, 429 detail, unknown reasons, finishReason mapped back so reply texts stay the same. Nit: the no-target DM path skips failure accounting. Lead checks: loadModelTarget joins pc.owner = ais.owner with status active; no hand-rolled chat/completions call left; the 2 new tests pass locally (12 tests); the Effect 4.0.4 bump loads on web (headless, mock, no page errors) and the phone smoke PASSES (/, /ais, /settings/connections). Live after deploy: Julio OK'd AGENT_GATEWAY_ENABLED=true; then Julio adds his key and DMs an AI.

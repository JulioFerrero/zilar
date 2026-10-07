---
id: T-0513
title: "Agents C1: requestCompletion in agents/reply.ts behind one Effect boundary (tryPromise with signal, timeoutOrElse over fetch+stream, typed error mapped to the same ChatCompletionError); its zod response schema to Effect Schema; SSE parser unchanged"
status: todo
milestone: M5
branch: task/T-0513-agents-c1-completion-effect
model: auto
effort: low
depends_on: [T-0503]
estimate: 0.5 day
---

# T-0513: agents C1, the model call on Effect

## Spec (written by Claude, do not edit)

### Why
Julio, 2026-10-07: the whole codebase on Effect 4, with Effect Schema replacing zod. Plan `docs/audit/effect-agents-plan.md` §5 (T-0503, merged) recommends **one Effect boundary around the whole completion call**, keeping the SSE parser (`stream.ts`) a plain async function. It is task C1, and it does not touch `gateway.ts`, so it runs in parallel with the G-extractions.

### Verified facts (do not re-derive)
- **`apps/server/src/agents/reply.ts`:**
  - `import { z } from 'zod'` (line 1);
  - `REPLY_MAX_TOKENS = 1024` (24) and `LITELLM_CHAT_TIMEOUT_MS = 90_000` (27);
  - **`export class ChatCompletionError(status, detail)`** (55);
  - `RawToolCallSchema` (126) and `ChatCompletionsResponseSchema` (131) are zod.
- **`async function requestCompletion(input: CompleteChatInput)`** (205-287):
  - the URL is `<baseUrl without trailing slashes>/chat/completions`, and `secrets = [virtualKey, ...input.secrets]`;
  - **`fetchImpl(url, { POST, JSON body with stream: true, signal: AbortSignal.timeout(timeoutMs) })`**. A throw becomes `ChatCompletionError(0, redactSecrets(message || 'network error'))`. **The same signal also covers the whole stream read.**
  - **A non-OK response** becomes `ChatCompletionError(status, redactSecrets(errorDetail(parseBody(text))))`;
  - **an `event-stream` response:** a null body gives `ChatCompletionError(0, 'the stream had no body')`; otherwise `consumeChatCompletionStream(response.body, input.onDelta)` (`stream.ts`), mapping toolCalls to `{ id, name, argsJson }`. A `ChatStreamInterruptedError` or any other error becomes `ChatCompletionError(0, redacted message)`;
  - **otherwise plain JSON:** `hasErrorBody` gives `ChatCompletionError(status, …)`; a failed `ChatCompletionsResponseSchema.safeParse` gives `ChatCompletionError(200, 'unexpected response shape')`; the content is trimmed, with empty meaning null, and the tool calls are mapped.
- **The callers** are inside `reply.ts` only: lines 311, 812, 1014 and 1306. Nothing outside the file calls `requestCompletion`.
- **Tests:**
  - `apps/server/src/agents/reply.test.ts` (`ChatCompletionError` instances, statuses, **the message never contains the virtual key** (lines 155-189), `mapFailureToReply` mappings);
  - `apps/server/src/agents/stream.test.ts`;
  - `apps/server/src/agents/rounds.test.ts`;
  - `apps/server/src/agents/gateway.test.ts`.
- **The idioms:** `docs/EFFECT_GUIDE.md`:
  - `Effect.tryPromise` passes an `AbortSignal` that fires on interruption; hand it to fetch;
  - `timeoutOrElse` interrupts the source and keeps the typed error;
  - T-0492's `voice-transcription/provider.ts` is the closest merged example (a provider call, tagged errors, the same error at the edge).
  - For the Schema patterns, see the same guide's "Schema" bullets.

### What to build
1. **`requestCompletion` becomes an Effect program** (an `Effect.gen` or `Effect.fn`) with tagged errors per case: network, HTTP status, no body, stream broken, bad shape, provider error body.
   - **One `Effect.timeoutOrElse(timeoutMs)` wraps fetch plus the stream read plus the JSON read**, and its timeout maps to the same `ChatCompletionError(0, …)` path that `AbortSignal.timeout` produced. Use the `tryPromise` signal for fetch, so the timeout aborts the live request.
   - **The exported `async function` keeps its signature** and runs the Effect with `Effect.runPromise` at the edge, mapping every typed error to **the same `ChatCompletionError(status, redacted detail)`** as today. Secrets are redacted exactly as before.
2. **`consumeChatCompletionStream` stays a plain async function** (`stream.ts` unchanged), called through `Effect.tryPromise`.
3. **`RawToolCallSchema` and `ChatCompletionsResponseSchema` become Effect Schema** with the same shape. The decode is non-strict (unknown keys ignored, as zod `z.object` did). If `zod` is no longer used in `reply.ts`, remove the import; other server files still use zod.
4. **Nothing else in `reply.ts` changes:** not the tool loop, nor the callers at 311, 812, 1014 and 1306.
5. **Tests:** `reply.test.ts`, `stream.test.ts`, `rounds.test.ts` and `gateway.test.ts` pass **unchanged**. Add `apps/server/src/agents/reply.effect.test.ts` covering:
   - a timeout during the stream read aborts the fetch signal and gives a status-0 `ChatCompletionError` without the key;
   - a provider error body maps to its status;
   - a JSON response with an extra unknown field still parses.

### Read first
`AGENTS.md`, `docs/EFFECT_GUIDE.md`, `docs/audit/effect-agents-plan.md` §5, `apps/server/src/agents/reply.ts:1-320`, `apps/server/src/agents/stream.ts`, `apps/server/src/voice-transcription/provider.ts`.

### Allowed files
`apps/server/src/agents/reply.ts`, `apps/server/src/agents/reply.effect.test.ts`, `work/T-0513-agents-c1-completion-effect.md`.

### Checks
```bash
pnpm --filter @zilar/server test --maxWorkers=2 --reporter=dot agents/reply agents/stream agents/rounds
pnpm gate
```

### Acceptance
- `requestCompletion` runs as one Effect with a single timeout covering fetch and stream.
- The errors and redaction are identical, and the response schemas are on Effect Schema.
- The existing tests are untouched and green, and the new test passes.
- `pnpm gate` ends with GATE PASS and lists no file outside the Allowed files.

---

## Report (written by the worker when done)

## Review (written by Claude)

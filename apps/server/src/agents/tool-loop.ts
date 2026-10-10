import { Data, Duration, Effect, Result, Schema, type Effect as EffectType } from 'effect';
import { redactSecrets, type FetchLike } from '../ai/litellm-client';
import { consumeChatCompletionStream } from './stream';
import {
  DELEGATE_TOOL,
  MEMORY_ZOOM_TOOL,
  RECALL_TOOL,
  REMEMBER_TOOL,
  REQUEST_ACTION_TOOL,
  REVERT_PERSONA_TOOL,
  TASK_STATUS_TOOL,
  UPDATE_PERSONA_TOOL,
  type ChatToolDefinition,
} from './tools';

// Cap on every completion request, enforced in code from day one (§8.4).
export const REPLY_MAX_TOKENS = 1024;

// How long one turn waits for LiteLLM before telling the owner to retry.
export const LITELLM_CHAT_TIMEOUT_MS = 90_000;

export const BUDGET_EXCEEDED_REPLY =
  "I've reached my spending limit for this period. You can raise it in My AIs.";
export const PROVIDER_KEY_REJECTED_REPLY =
  'My provider rejected the API key. Check it under Connections → Test.';
export const TRANSIENT_FAILURE_REPLY = "I couldn't reply just now. Please try again in a minute.";

// A failed `/chat/completions` call. The detail is redacted at construction:
// it never carries the virtual key, whatever LiteLLM echoed back.
export class ChatCompletionError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(
      status === 0
        ? `chat completions request failed: ${detail}`
        : `chat completions failed with HTTP ${status}: ${detail}`,
    );
    this.name = 'ChatCompletionError';
    this.status = status;
    this.detail = detail;
  }
}

// One raw tool call the model asked for, straight off the response.
export interface ChatToolCall {
  id: string;
  name: string;
  argsJson: string;
}

// A validated call the executor may run. Unknown tools and invalid arguments
// never reach this shape: they get `invalid: …` back instead.
export type ValidToolCall =
  | { id: string; tool: typeof UPDATE_PERSONA_TOOL; persona: string; summary: string }
  | { id: string; tool: typeof REVERT_PERSONA_TOOL }
  | {
      id: string;
      tool: typeof REQUEST_ACTION_TOOL;
      action: string;
      args: Record<string, unknown>;
    }
  | { id: string; tool: typeof RECALL_TOOL; query: string }
  | { id: string; tool: typeof MEMORY_ZOOM_TOOL; block: string }
  | { id: string; tool: typeof REMEMBER_TOOL; text: string }
  | {
      id: string;
      tool: typeof DELEGATE_TOOL;
      toAiId: string;
      objective: string;
      contextSummary?: string;
      acceptance?: string[];
      returnFormat?: string;
    }
  | { id: string; tool: typeof TASK_STATUS_TOOL; taskId: string };

export interface ToolExecution {
  // A short result for the model: "ok", "nothing to undo" or "invalid: …".
  content: string;
  // A fixed line for the owner's DM, present only when the persona changed.
  notice?: string;
}

export type ExecuteToolCall = (call: ValidToolCall) => Promise<ToolExecution>;

// A message on the wire. The context builder produces the system/user/
// assistant turns; the tool loop appends assistant `tool_calls` and `tool`
// results for the follow-up call.
export interface ModelRequestMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

// Effect Schema replaces zod here (T-0513). The shapes are identical: a plain
// struct ignores unknown keys exactly as `z.object` did, and `optionalKey` is
// zod's `.optional()`.
const RawToolCallSchema = Schema.Struct({
  id: Schema.String,
  function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
});

const ChatCompletionsResponseSchema = Schema.Struct({
  choices: Schema.Array(
    Schema.Struct({
      message: Schema.optionalKey(
        Schema.Struct({
          content: Schema.optionalKey(Schema.NullOr(Schema.String)),
          tool_calls: Schema.optionalKey(Schema.Array(RawToolCallSchema)),
        }),
      ),
    }),
  ).check(Schema.isMinLength(1)),
});

export interface CompleteChatInput {
  baseUrl: string;
  virtualKey: string;
  model: string;
  messages: ModelRequestMessage[];
  tools?: ChatToolDefinition[];
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  /** Extra secrets to redact from every error (e.g. the master key). */
  secrets?: readonly string[];
  /** Called with the cumulative text every time the stream grows. */
  onDelta?: (textSoFar: string) => void;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ChatToolCall[];
}

function errorDetail(body: unknown): string {
  if (typeof body === 'string') {
    return body === '' ? 'no response body' : body;
  }
  if (body !== null && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
    if (error !== null && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    try {
      return JSON.stringify(body);
    } catch {
      return 'unreadable response body';
    }
  }
  return 'no response body';
}

function hasErrorBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object') {
    return false;
  }
  const error = (body as { error?: unknown }).error;
  return typeof error === 'string' || (error !== null && typeof error === 'object');
}

// One typed failure per completion failure mode. Each `detail` is redacted
// where the error is built, so the typed channel never carries a secret; the
// Promise edge maps every one to the same `ChatCompletionError(status, detail)`
// the function always threw.
class CompletionUnreachable extends Data.TaggedError('CompletionUnreachable')<{
  detail: string;
}> {}
class CompletionTimeout extends Data.TaggedError('CompletionTimeout') {}
class CompletionNoBody extends Data.TaggedError('CompletionNoBody') {}
class CompletionStreamBroken extends Data.TaggedError('CompletionStreamBroken')<{
  detail: string;
}> {}
class CompletionBadShape extends Data.TaggedError('CompletionBadShape') {}
class CompletionHttpError extends Data.TaggedError('CompletionHttpError')<{
  status: number;
  detail: string;
}> {}
class CompletionErrorBody extends Data.TaggedError('CompletionErrorBody')<{
  status: number;
  detail: string;
}> {}
class CompletionBodyUnreadable extends Data.TaggedError('CompletionBodyUnreadable') {}

type CompletionFailure =
  | CompletionUnreachable
  | CompletionNoBody
  | CompletionStreamBroken
  | CompletionBadShape
  | CompletionHttpError
  | CompletionErrorBody
  | CompletionBodyUnreadable;

// One model call for one turn, authenticated as the AI with its own capped
// virtual key. Every call streams (`stream: true`): text deltas are reported
// through `onDelta` as they arrive, and the result has the same shape the
// tool loop already understands. A stream that breaks midway or times out
// (the same per-call timeout, now covering the whole stream) counts as a
// network failure. If the provider ignores `stream` and answers plain JSON,
// that shape is parsed the way it always was.
const requestCompletionEffect = Effect.fnUntraced(function* (
  input: CompleteChatInput,
  secrets: readonly string[],
): EffectType.fn.Return<ChatCompletionResult, CompletionFailure> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const requestBody = JSON.stringify({
    model: input.model,
    messages: input.messages,
    max_tokens: REPLY_MAX_TOKENS,
    stream: true,
    ...(input.tools === undefined ? {} : { tools: input.tools, tool_choice: 'auto' }),
  });

  // The controller is held for the whole call: `timeoutOrElse` interrupts this
  // effect, its release aborts the live request (headers, stream and all).
  // `Effect.tryPromise`'s own signal stops covering the socket once `fetch`
  // resolves its headers, so it cannot abort the stream read on its own.
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(url, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${input.virtualKey}`,
              },
              body: requestBody,
              signal: controller.signal,
            }),
          catch: (cause) =>
            new CompletionUnreachable({
              detail: redactSecrets(
                cause instanceof Error ? cause.message : 'network error',
                secrets,
              ),
            }),
        });

        // HTTP errors surface before the stream starts and map exactly as before.
        if (!response.ok) {
          const text = yield* readBodyTextEffect(response);
          return yield* new CompletionHttpError({
            status: response.status,
            detail: redactSecrets(errorDetail(parseBody(text)), secrets),
          });
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('text/event-stream')) {
          const body = response.body;
          if (body === null) {
            return yield* new CompletionNoBody();
          }
          const streamed = yield* Effect.tryPromise({
            try: () => consumeChatCompletionStream(body, input.onDelta),
            catch: (error) =>
              new CompletionStreamBroken({
                detail: redactSecrets(
                  error instanceof Error ? error.message : 'network error',
                  secrets,
                ),
              }),
          });
          return {
            content: streamed.content,
            toolCalls: streamed.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              argsJson: call.argsJson,
            })),
          };
        }

        const text = yield* readBodyTextEffect(response);
        const body: unknown = parseBody(text);

        if (hasErrorBody(body)) {
          return yield* new CompletionErrorBody({
            status: response.status,
            detail: redactSecrets(errorDetail(body), secrets),
          });
        }

        const decoded = Schema.decodeUnknownResult(ChatCompletionsResponseSchema)(body);
        if (Result.isFailure(decoded)) {
          return yield* new CompletionBadShape();
        }
        const message = decoded.success.choices[0]?.message;
        const content = message?.content?.trim() ?? '';
        return {
          content: content === '' ? null : content,
          toolCalls: (message?.tool_calls ?? []).map((call) => ({
            id: call.id,
            name: call.function.name,
            argsJson: call.function.arguments,
          })),
        };
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

export async function requestCompletion(input: CompleteChatInput): Promise<ChatCompletionResult> {
  const secrets = [input.virtualKey, ...(input.secrets ?? [])];
  const timeoutMs = input.timeoutMs ?? LITELLM_CHAT_TIMEOUT_MS;
  return Effect.runPromise(
    requestCompletionEffect(input, secrets).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs),
        orElse: () => Effect.fail(new CompletionTimeout()),
      }),
      Effect.catchTags({
        CompletionUnreachable: (error) => Effect.fail(new ChatCompletionError(0, error.detail)),
        CompletionTimeout: () => Effect.fail(new ChatCompletionError(0, 'the request timed out')),
        CompletionNoBody: () => Effect.fail(new ChatCompletionError(0, 'the stream had no body')),
        CompletionStreamBroken: (error) => Effect.fail(new ChatCompletionError(0, error.detail)),
        CompletionBadShape: () =>
          Effect.fail(new ChatCompletionError(200, 'unexpected response shape')),
        CompletionHttpError: (error) =>
          Effect.fail(new ChatCompletionError(error.status, error.detail)),
        CompletionErrorBody: (error) =>
          Effect.fail(new ChatCompletionError(error.status, error.detail)),
        CompletionBodyUnreadable: () =>
          Effect.fail(new ChatCompletionError(0, 'the response body could not be read')),
      }),
    ),
  );
}

function readBodyTextEffect(
  response: Response,
): EffectType.Effect<string, CompletionBodyUnreadable> {
  return Effect.tryPromise({
    try: () => response.text(),
    catch: () => new CompletionBodyUnreadable(),
  });
}

function parseBody(text: string): unknown {
  if (text === '') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// T-0106: per-turn caps for the multi-round tool loop. The wall clock keeps
// one long turn from holding the pump forever; the call cap keeps a looping
// model from executing unbounded side effects. Both are fixed, not config:
// `AGENT_TOOL_MAX_ROUNDS` is the only knob.
export const TOOL_TURN_WALL_CLOCK_MS = 120_000;
export const TOOL_TURN_MAX_CALLS = 12;

// T-0106: each tool result fed back to the model is truncated to this many
// characters. Adapter summaries are already short; `modelText` (tool source,
// test output, fetched pages) can be 16 KiB, and several rounds of that
// would bloat the context. Still wrapped in `<untrusted-tool-output>`.
export const TOOL_RESULT_MAX_CHARS = 8 * 1024;

// T-0106: a round that asks for the same call with the same arguments as the
// previous round is answered with this, without executing again.
export const TOOL_REPEAT_RESULT = 'already done: this call ran in the previous round';

// T-0106: every call dropped by the per-turn call cap still gets a result,
// so no assistant `tool_calls` entry is left without a matching `tool`
// message. An unmatched tool call makes providers answer 400 on the next
// (and the final tool-free) model call, so capping must never corrupt the
// follow-up history.
export const TOOL_CAPPED_RESULT = 'capped: turn call limit reached';

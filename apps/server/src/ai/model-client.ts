// The one place a model call is made (docs/audit/effect-ai-plan.md §5.1).
// `ModelClient.chat` builds a provider client for this call only (the AI's own
// decrypted key), converts our messages and tools to Effect AI shapes, streams
// when a delta callback is given, and maps every `AiError` back to the existing
// `ChatCompletionError` seam so the failure classification and the user-facing
// reply texts stay exactly as they were.
import { Duration, Effect, Schedule, Stream } from 'effect';
import { AiError, type Response as AiResponse, type Tool } from 'effect/ai';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { customProviderFetch, type PinnedFetchOptions } from '../connections/pinned-fetch';
import { redactSecrets, type FetchLike } from './http';
import {
  toPrompt,
  toToolkit,
  type ModelRequestMessage,
  type ModelToolDefinition,
} from './model-prompt';
import { buildLanguageModel, type ModelTarget } from './providers';

export type { ModelTarget } from './providers';
export type { ModelRequestMessage, ModelToolDefinition } from './model-prompt';

// How long one model call waits before the turn tells the owner to retry.
export const MODEL_CHAT_TIMEOUT_MS = 90_000;

// A failed chat-completions call. The detail is redacted where the error is
// built: it never carries the key, whatever the provider echoed back.
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

// Token usage for one call: the four counters `ai_usage` keeps (T-1400).
export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelCallResult {
  content: string | null;
  toolCalls: ChatToolCall[];
  /**
   * AI-5: `length` when the provider cut the reply at the token cap. This is
   * the SDK's normalized reason, not the provider's raw `finish_reason`:
   * `length`/`stop` pass through, `tool_calls`/`function_call` become
   * `tool-calls`, and anything else becomes `unknown`. Only `length` is read
   * today (`cutShortSuffix` in `replies.ts`).
   */
  finishReason?: string;
  usage: ChatUsage;
}

export interface ModelCallInput {
  target: ModelTarget;
  messages: ModelRequestMessage[];
  tools?: ModelToolDefinition[];
  /** Called with the cumulative text every time the stream grows. */
  onDelta?: (textSoFar: string) => void;
  /** Called with the token counters when the provider reports them. */
  onUsage?: (usage: ChatUsage) => void;
  maxTokens?: number;
  timeoutMs?: number;
  /** Extra secrets to redact from every error (e.g. a connection key). */
  secrets?: readonly string[];
  /** Transport seam for tests: the `fetch` the client sends through. Ignored for
   * `openai-compatible`, which always uses the pinned fetch (T-1396). */
  fetchImpl?: FetchLike;
  /**
   * T-1396, test only: options for the custom provider's pinned fetch (an
   * injected DNS resolver, or the allow-private hook for a loopback fake
   * server). A caller-supplied `fetchImpl` never replaces the pinned fetch for
   * `openai-compatible`; inject these instead.
   */
  pinnedFetchOptions?: PinnedFetchOptions;
}

const EMPTY_USAGE: ChatUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const RETRY_DELAY_MS = 2_000;

// The HTTP status our failure classes expect, from the `AiError` reason.
function statusOf(reason: AiError.AiErrorReason): number {
  switch (reason._tag) {
    case 'RateLimitError':
      return 429;
    case 'AuthenticationError':
      return reason.kind === 'InsufficientPermissions' ? 403 : 401;
    case 'QuotaExhaustedError':
    case 'InvalidRequestError':
    case 'ContentPolicyError':
      return 400;
    case 'InternalProviderError':
      return 500;
    // SDK-side parse failures (a malformed tool-args chunk, a bad SSE frame)
    // are not worth a retry: the old transport mapped them to a non-retryable
    // `ChatCompletionError(200, …)`, and the provider would answer the same
    // bytes again. The turn fails with the transient text instead.
    case 'ToolParameterValidationError':
    case 'InvalidOutputError':
      return 200;
    default: {
      // The SDK's response-carrying fallthrough (`UnknownError`, any status
      // below 500 that the provider package did not map). Keep the real HTTP
      // status, so an unmapped response (402, 418) is a non-retryable
      // `provider_error`, exactly as the old transport classified it.
      const httpStatus = 'http' in reason ? reason.http?.response?.status : undefined;
      return httpStatus ?? 0;
    }
  }
}

// The message a provider's JSON error body carries (`{"error":{"message":…}}`),
// falling back to the raw body. The old transport's `errorDetail` did the same;
// `RateLimitError` is the one SDK reason that keeps the body but no
// `description`, so its detail would otherwise be a fixed string.
function providerBodyMessage(body: string | undefined): string | undefined {
  if (body === undefined || body === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (parsed !== null && typeof parsed === 'object') {
    const error = (parsed as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
    if (error !== null && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
    return JSON.stringify(parsed);
  }
  return body;
}

// The detail string our `classifyFailure` patterns read. It keeps the
// provider's description (where our old `errorDetail` kept the body) so the
// model-name and context-length patterns still match; the budget reason is
// named so the budget reply keeps working.
function detailOf(reason: AiError.AiErrorReason): string {
  switch (reason._tag) {
    case 'RateLimitError':
      // A 429 body can still name a model or context problem; keep the
      // provider's message so the detail matches the old transport's body.
      // The budget branch reads this detail first (`classifyFailure`), and a
      // 429 whose body says "budget" must still map to the budget reply.
      return providerBodyMessage(reason.http?.body) ?? 'rate limited';
    case 'AuthenticationError':
      return `authentication failed: ${reason.kind}`;
    case 'QuotaExhaustedError':
      return 'budget exhausted';
    case 'InvalidRequestError':
      return reason.description ?? 'invalid request';
    case 'ContentPolicyError':
      return reason.description ?? 'content policy violation';
    case 'InternalProviderError':
      return reason.description ?? 'internal provider error';
    case 'NetworkError':
      return reason.description ?? `network error: ${reason.reason}`;
    default:
      return reason.message;
  }
}

// The one mapping from an Effect AI error to our long-standing
// `ChatCompletionError(status, detail)` seam (§3.7).
export function chatErrorFromAiError(
  error: AiError.AiError,
  secrets: readonly string[] = [],
): ChatCompletionError {
  return new ChatCompletionError(
    statusOf(error.reason),
    redactSecrets(detailOf(error.reason), secrets),
  );
}

function usageOf(usage: AiResponse.Usage): ChatUsage {
  return {
    inputTokens: usage.inputTokens.uncached ?? usage.inputTokens.total ?? 0,
    outputTokens: usage.outputTokens.total ?? usage.outputTokens.text ?? 0,
    cacheReadTokens: usage.inputTokens.cacheRead ?? 0,
    cacheWriteTokens: usage.inputTokens.cacheWrite ?? 0,
  };
}

function normalizeContent(text: string): string | null {
  const trimmed = text.trim();
  return trimmed === '' ? null : trimmed;
}

function argsJsonOf(params: unknown): string {
  try {
    return JSON.stringify(params);
  } catch {
    return '{}';
  }
}

// One call through the provider client. No retry here: the caller owns the
// deadline and the streamed-once rule. Every call streams (`stream_options`
// carries usage), and `onDelta` only decides whether the caller sees the text
// as it grows.
function callOnce(
  input: ModelCallInput,
): Effect.Effect<ModelCallResult, AiError.AiError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const model = yield* buildLanguageModel(input.target, input.maxTokens);
    const prompt = toPrompt(input.messages);
    const toolkit = toToolkit(input.tools ?? []);
    // `Tool.HandlerServices` types the toolkit as carrying handlers even when
    // it carries none; the cast drops that phantom requirement. Nothing is
    // resolved by the framework here (`disableToolCallResolution`), so no
    // handler is ever invoked.
    const options = {
      prompt,
      disableToolCallResolution: true as const,
      toolCallValidation: 'deferred' as const,
      ...(toolkit === undefined ? {} : { toolkit }),
    };
    const stream = model.streamText(options as never) as unknown as Stream.Stream<
      AiResponse.StreamPart<Record<string, Tool.Any>, 'deferred'>,
      AiError.AiError
    >;
    let text = '';
    const toolCalls: ChatToolCall[] = [];
    let finishReason: string | undefined;
    let usage: ChatUsage = EMPTY_USAGE;

    yield* Stream.runForEach(stream, (part) =>
      Effect.sync(() => {
        switch (part.type) {
          case 'text-delta':
            text += part.delta;
            input.onDelta?.(text);
            break;
          case 'tool-call':
            toolCalls.push({ id: part.id, name: part.name, argsJson: argsJsonOf(part.params) });
            break;
          case 'finish':
            finishReason = part.reason;
            usage = usageOf(part.usage);
            break;
          default:
            break;
        }
      }),
    );
    return {
      content: normalizeContent(text),
      toolCalls,
      ...(finishReason === undefined ? {} : { finishReason }),
      usage,
    };
  });
}

// One retry for the failures worth retrying (a 429, a 5xx, a refused or
// timed-out connection), and only while nothing has streamed yet. `effect/ai`
// never retries: `AiError.isRetryable` is a flag, not a schedule.
function isRetryable(error: ChatCompletionError): boolean {
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

// T-1396: the transport for one call. A custom provider is ALWAYS called
// through the pinned fetch — a caller-supplied `fetchImpl` must never replace
// it, or the SSRF guard would be dropped. Tests inject the pinned fetch's
// resolver / allow-private hook through `pinnedFetchOptions` instead of
// swapping the fetch. Without a base URL there is nothing safe to call, so the
// call fails rather than falling back to the default client.
function modelTransport(input: ModelCallInput): FetchLike | undefined {
  if (input.target.provider !== 'openai-compatible') {
    return input.fetchImpl;
  }
  if (input.target.apiUrl === undefined) {
    throw new Error('openai-compatible requires a base URL');
  }
  return customProviderFetch(input.target, input.pinnedFetchOptions);
}

export function chat(input: ModelCallInput): Promise<ModelCallResult> {
  const secrets = [input.target.apiKey, ...(input.secrets ?? [])];
  const timeoutMs = input.timeoutMs ?? MODEL_CHAT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let streamed = false;
  const withUsage = (result: ModelCallResult): ModelCallResult => {
    input.onUsage?.(result.usage);
    return result;
  };
  const call: ModelCallInput = {
    ...input,
    // AI-3: the streamed-once rule has to hold on every call. The wrapper is
    // always installed, not only when the caller wants deltas, so a call that
    // already streamed text is never repeated as a second paid request.
    onDelta: (textSoFar) => {
      streamed = true;
      input.onDelta?.(textSoFar);
    },
  };
  // Each attempt gets what is left of the deadline (AI-3), never a fresh
  // window: the timeout is built inside the suspend, so a retry after a slow
  // first attempt waits the remainder, not the full timeout again.
  const attempt = (): Effect.Effect<ModelCallResult, ChatCompletionError> => {
    const transport = modelTransport(call);
    const once = Effect.provide(callOnce(call), FetchHttpClient.layer).pipe(
      Effect.mapError((error) => chatErrorFromAiError(error, secrets)),
      Effect.map(withUsage),
      Effect.timeoutOrElse({
        duration: Duration.millis(Math.max(0, deadline - Date.now())),
        orElse: () => Effect.fail(new ChatCompletionError(0, 'the request timed out')),
      }),
    );
    return transport === undefined
      ? once
      : Effect.provideService(
          once,
          FetchHttpClient.Fetch,
          transport as unknown as typeof globalThis.fetch,
        );
  };
  return Effect.runPromise(
    Effect.suspend(attempt).pipe(
      Effect.retry({
        schedule: Schedule.max([Schedule.recurs(1), Schedule.spaced(RETRY_DELAY_MS)]),
        while: (error) => !streamed && Date.now() + RETRY_DELAY_MS < deadline && isRetryable(error),
      }),
    ),
  );
}

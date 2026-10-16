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
import { type FetchLike } from './http';
import { ChatCompletionError, chatErrorFromAiError } from './model-errors';
import {
  toPrompt,
  toToolkit,
  type ModelRequestMessage,
  type ModelToolDefinition,
} from './model-prompt';
import { buildLanguageModel, type ModelTarget } from './providers';

export type { ModelTarget } from './providers';
export type { ModelRequestMessage, ModelToolDefinition } from './model-prompt';

// The failure seam lives in `model-errors.ts`; re-exported here so callers keep
// importing `ChatCompletionError` and `chatErrorFromAiError` from this module.
export { ChatCompletionError, chatErrorFromAiError } from './model-errors';

// How long one model call waits before the turn tells the owner to retry.
export const MODEL_CHAT_TIMEOUT_MS = 90_000;

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
   * T-1422: the turn's abort signal. When it fires, the call fails at once and
   * the model stream is interrupted, so a stopped turn spends no more time.
   */
  signal?: AbortSignal;
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
// T-1422: the fixed failure a stopped turn gets. It is a `status: 0` error
// (transient) but the retry loop never retries an aborted turn, because the
// signal is checked in `chat`'s retry condition.
const TURN_STOPPED_DETAIL = 'the request was stopped';

// T-1422: races one model-call effect against the turn's abort signal, so an
// abort interrupts the in-flight stream and fails the call at once. Without a
// signal the effect passes through unchanged.
function withAbort<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E | ChatCompletionError, R> {
  if (signal === undefined) {
    return effect;
  }
  if (signal.aborted) {
    return Effect.fail(new ChatCompletionError(0, TURN_STOPPED_DETAIL));
  }
  const aborted = Effect.callback<never, ChatCompletionError>((resume) => {
    const onAbort = (): void => {
      resume(Effect.fail(new ChatCompletionError(0, TURN_STOPPED_DETAIL)));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener('abort', onAbort));
  });
  return Effect.raceFirst(effect, aborted);
}

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
  const program = Effect.suspend(attempt).pipe(
    Effect.retry({
      schedule: Schedule.max([Schedule.recurs(1), Schedule.spaced(RETRY_DELAY_MS)]),
      // T-1422: an aborted turn never retries; the error is transient by shape
      // (status 0) but the owner asked to stop.
      while: (error) =>
        !streamed &&
        input.signal?.aborted !== true &&
        Date.now() + RETRY_DELAY_MS < deadline &&
        isRetryable(error),
    }),
  );
  return Effect.runPromise(withAbort(program, input.signal));
}

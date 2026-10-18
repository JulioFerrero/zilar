// The one place a model call is made: builds a provider client per call from
// the AI's decrypted key and maps every `AiError` to `ChatCompletionError`.
import { Duration, Effect, Schedule, Stream, type JsonSchema } from 'effect';
import { AiError, type Response as AiResponse, Prompt, Tool, Toolkit } from 'effect/ai';
import { FetchHttpClient, type HttpClient } from 'effect/http';
import { customProviderFetch, type PinnedFetchOptions } from '../connections/pinned-fetch';
import { type FetchLike, redactSecrets } from './http';
import { buildLanguageModel, type ModelTarget } from './providers';

// Converts our wire shapes into the Effect AI `Prompt`/`Toolkit` shapes.
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

export interface ModelToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// An empty or malformed arguments string becomes `{}` so the prompt still
// decodes; the executor validates the original itself.
function parseArguments(argsJson: string): unknown {
  if (argsJson.trim() === '') {
    return {};
  }
  try {
    return JSON.parse(argsJson);
  } catch {
    return {};
  }
}

// A tool result only carries the call id; the name comes from the assistant
// `tool_calls` it answers.
function toolNamesById(messages: readonly ModelRequestMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      names.set(call.id, call.function.name);
    }
  }
  return names;
}

function encodeMessage(
  message: ModelRequestMessage,
  names: Map<string, string>,
): Prompt.MessageEncoded {
  switch (message.role) {
    case 'system':
      return { role: 'system', content: message.content };
    case 'user':
      return { role: 'user', content: message.content };
    case 'assistant': {
      const parts: Array<Prompt.AssistantMessagePartEncoded> = [];
      if (message.content !== '') {
        parts.push({ type: 'text', text: message.content });
      }
      for (const call of message.tool_calls ?? []) {
        parts.push({
          type: 'tool-call',
          id: call.id,
          name: call.function.name,
          params: parseArguments(call.function.arguments),
        });
      }
      return parts.length === 0
        ? { role: 'assistant', content: '' }
        : { role: 'assistant', content: parts };
    }
    case 'tool': {
      const id = message.tool_call_id ?? '';
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            id,
            name: names.get(id) ?? 'unknown',
            result: message.content,
            isFailure: false,
          },
        ],
      };
    }
  }
}

export function toPrompt(messages: readonly ModelRequestMessage[]): Prompt.Prompt {
  const names = toolNamesById(messages);
  return Prompt.make(messages.map((message) => encodeMessage(message, names)));
}

// A dynamic tool needs no handler: the agent loop validates and executes every
// call itself (`disableToolCallResolution`), so the one here is never invoked.
export function toToolkit(
  definitions: readonly ModelToolDefinition[],
): Toolkit.WithHandler<Record<string, Tool.Any>> | undefined {
  if (definitions.length === 0) {
    return undefined;
  }
  const tools: Array<Tool.Any> = definitions.map((definition) =>
    Tool.dynamic(definition.function.name, {
      description: definition.function.description,
      parameters: definition.function.parameters as unknown as JsonSchema.JsonSchema,
    }),
  );
  return Toolkit.make(...tools) as unknown as Toolkit.WithHandler<Record<string, Tool.Any>>;
}
// The failure seam for a model call: the error a caller sees and the one
// mapping from an Effect AI error to its status and detail.
// The detail is redacted where the error is built: it never carries the key,
// whatever the provider echoed back.
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
    // SDK parse failures are not worth a retry: the provider would answer the
    // same bytes again, so the turn fails with the transient text.
    case 'ToolParameterValidationError':
    case 'InvalidOutputError':
      return 200;
    default: {
      // Unmapped response-carrying errors keep their real HTTP status, so an
      // unmapped 402 or 418 stays a non-retryable provider error.
      const httpStatus = 'http' in reason ? reason.http?.response?.status : undefined;
      return httpStatus ?? 0;
    }
  }
}

// The message a provider's JSON error body carries, falling back to the raw
// body: `RateLimitError` keeps the body but no `description`.
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

// The detail `classifyFailure` reads: it keeps the provider's description so
// the model-name and context-length patterns still match.
function detailOf(reason: AiError.AiErrorReason): string {
  switch (reason._tag) {
    case 'RateLimitError':
      // A 429 body can still name a model, context or budget problem, so keep
      // the provider's message for `classifyFailure`.
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

export function chatErrorFromAiError(
  error: AiError.AiError,
  secrets: readonly string[] = [],
): ChatCompletionError {
  return new ChatCompletionError(
    statusOf(error.reason),
    redactSecrets(detailOf(error.reason), secrets),
  );
}
export type { ModelTarget } from './providers';

export const MODEL_CHAT_TIMEOUT_MS = 90_000;

export interface ChatToolCall {
  id: string;
  name: string;
  argsJson: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelCallResult {
  content: string | null;
  toolCalls: ChatToolCall[];
  /** `length` when the provider cut the reply at the token cap; the only value read today. */
  finishReason?: string;
  usage: ChatUsage;
}

export interface ModelCallInput {
  target: ModelTarget;
  messages: ModelRequestMessage[];
  tools?: ModelToolDefinition[];
  /** Called with the cumulative text every time the stream grows. */
  onDelta?: (textSoFar: string) => void;
  onUsage?: (usage: ChatUsage) => void;
  maxTokens?: number;
  timeoutMs?: number;
  /** Extra secrets to redact from every error (e.g. a connection key). */
  secrets?: readonly string[];
  /** Test transport; ignored for `openai-compatible`, which always uses the pinned fetch. */
  fetchImpl?: FetchLike;
  /** The turn's abort signal: firing it fails the call at once and interrupts the stream. */
  signal?: AbortSignal;
  /** Test only: pinned-fetch options for the custom provider (resolver, or the allow-private hook for a loopback fake). */
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

// No retry here: the caller owns the deadline and the streamed-once rule. Every
// call streams, and `onDelta` only decides whether text is shown as it grows.
function callOnce(
  input: ModelCallInput,
): Effect.Effect<ModelCallResult, AiError.AiError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const model = yield* buildLanguageModel(input.target, input.maxTokens);
    const prompt = toPrompt(input.messages);
    const toolkit = toToolkit(input.tools ?? []);
    // The toolkit's handler type is phantom (`disableToolCallResolution`), so the cast is safe.
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

// One retry for a 429, 5xx, refused or timed-out connection, and only before
// anything streamed: `effect/ai` never retries.
function isRetryable(error: ChatCompletionError): boolean {
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

// A custom provider is ALWAYS called through the pinned fetch: a caller-supplied
// `fetchImpl` must never replace it, or the SSRF guard is dropped.
// status 0 is transient by shape, but `chat` never retries an aborted turn.
const TURN_STOPPED_DETAIL = 'the request was stopped';

// Races the call against the turn's abort signal so an abort interrupts the in-flight stream.
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
    // Always installed: a call that already streamed text is never repeated as a second paid request.
    onDelta: (textSoFar) => {
      streamed = true;
      input.onDelta?.(textSoFar);
    },
  };
  // Each attempt gets what is left of the deadline, never a fresh window.
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
      // An aborted turn never retries, though its error is transient by shape.
      while: (error) =>
        !streamed &&
        input.signal?.aborted !== true &&
        Date.now() + RETRY_DELAY_MS < deadline &&
        isRetryable(error),
    }),
  );
  return Effect.runPromise(withAbort(program, input.signal));
}

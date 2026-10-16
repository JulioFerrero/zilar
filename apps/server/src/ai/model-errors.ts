// The failure seam for a model call: the `ChatCompletionError` a caller sees,
// and the one mapping from an Effect AI error to its status and detail. Split
// out of `model-client.ts` so every call site keeps importing the same shape
// from `model-client` without that file growing past its size limit.
import { AiError } from 'effect/ai';
import { redactSecrets } from './http';

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

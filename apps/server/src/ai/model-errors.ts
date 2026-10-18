// The failure seam for a model call: the error a caller sees and the one
// mapping from an Effect AI error to its status and detail.
import { AiError } from 'effect/ai';
import { redactSecrets } from './http';

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

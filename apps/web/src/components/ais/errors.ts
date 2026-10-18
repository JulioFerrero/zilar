import { describeAiFailure, type AiErrorInfo } from '@zilar/chat-core';
import { ApiError } from '@/lib/api';
import type { ApiFailure } from '@/lib/effect/errors';

export type { AiErrorInfo };

// The code table lives in @zilar/chat-core; this keeps the web error class.
// A non-`ApiError` (a dropped request reads "Failed to fetch") is not the
// server talking, so the caller's fixed fallback shows instead.
export function describeAiError(error: unknown, fallback: string): AiErrorInfo {
  if (error instanceof ApiError) {
    return describeAiFailure(error);
  }
  return { message: fallback, unavailable: false };
}

export function aiFailureText(failure: ApiFailure, fallback: string): string {
  if (failure.code === 'unknown_error') {
    return fallback;
  }
  return describeAiError(
    new ApiError(failure.status, failure.code, failure.message, failure.detail),
    fallback,
  ).message;
}

import { describeAiFailure, type AiErrorInfo } from '@zilar/chat-core';
import { ApiError } from '@/lib/api';

export type { AiErrorInfo };

// The code table lives in @zilar/chat-core; this keeps the web error class.
// A non-`ApiError` (a dropped network request reads "Failed to fetch") is not
// the server talking, so the caller's fixed fallback shows instead (AI-21).
export function describeAiError(error: unknown, fallback: string): AiErrorInfo {
  if (error instanceof ApiError) {
    return describeAiFailure(error);
  }
  return { message: fallback, unavailable: false };
}

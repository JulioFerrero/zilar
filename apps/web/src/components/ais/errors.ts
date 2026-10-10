import { describeAiFailure, type AiErrorInfo } from '@zilar/chat-core';
import { ApiError } from '@/lib/api';

export type { AiErrorInfo };

// The code table lives in @zilar/chat-core; this keeps the web error class.
export function describeAiError(error: unknown, fallback: string): AiErrorInfo {
  if (error instanceof ApiError) {
    return describeAiFailure(error);
  }
  return { message: error instanceof Error ? error.message : fallback, unavailable: false };
}

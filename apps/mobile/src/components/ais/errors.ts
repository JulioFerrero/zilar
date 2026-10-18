import { describeAiFailure, type AiErrorInfo } from '@zilar/chat-core';

import { AisApiError } from '../../lib/ais-api';

export type AisErrorInfo = AiErrorInfo;

// `not_active` is the kill switch: the list is reloaded, so the row already matches the server's truth. Only the phone handles it.
export function describeAisError(error: unknown, fallback: string): AisErrorInfo {
  if (error instanceof AisApiError) {
    if (error.code === 'not_active') {
      return { message: 'This AI changed state. Refreshing the list…', unavailable: false };
    }
    return describeAiFailure(error);
  }
  return { message: error instanceof Error ? error.message : fallback, unavailable: false };
}

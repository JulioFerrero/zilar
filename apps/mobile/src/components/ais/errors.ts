import { describeAiFailure, type AiErrorInfo } from '@zilar/chat-core';

import { AisApiError } from '../../lib/ais-api';

export type AisErrorInfo = AiErrorInfo;

// The code table lives in @zilar/chat-core. `not_active` (T-0095) is the kill
// switch telling the owner the AI changed under them: the list is reloaded, so
// the row will already match the server's truth. Only the phone handles it.
export function describeAisError(error: unknown, fallback: string): AisErrorInfo {
  if (error instanceof AisApiError) {
    if (error.code === 'not_active') {
      return { message: 'This AI changed state. Refreshing the list…', unavailable: false };
    }
    return describeAiFailure(error);
  }
  return { message: error instanceof Error ? error.message : fallback, unavailable: false };
}

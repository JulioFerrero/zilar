import { ApiError } from '@/lib/api';

export interface AiErrorInfo {
  /** A clear message for the user; never a raw code or a stack trace. */
  message: string;
  /** True when the server has AI management switched off (503). */
  unavailable: boolean;
}

// Maps the error codes in the T-0032 contract to plain language. `invalid_request`
// keeps the server's own message because it explains which field is wrong.
export function describeAiError(error: unknown, fallback: string): AiErrorInfo {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'ais_unavailable':
        return { message: "AI management isn't configured on this server.", unavailable: true };
      case 'invalid_connection':
      case 'connection_inactive':
      case 'connection_not_llm':
        return {
          message: "That connection can't be used. Pick another one or re-add it.",
          unavailable: false,
        };
      case 'not_found':
        return { message: 'That AI no longer exists.', unavailable: false };
      case 'ai_provisioning_failed':
      case 'ai_update_failed':
      case 'ai_teardown_failed':
        return {
          message: "The server couldn't finish. Nothing was left half-created; try again.",
          unavailable: false,
        };
      default:
        return { message: error.message, unavailable: error.status === 503 };
    }
  }
  return { message: error instanceof Error ? error.message : fallback, unavailable: false };
}

import { ChatCompletionError } from './tool-loop';

export type AiFailureKind =
  | 'budget'
  | 'key_rejected'
  | 'rate_limited'
  | 'model_not_found'
  | 'context_too_long'
  | 'timeout'
  | 'provider_error'
  | 'other';

export interface AiFailureClass {
  kind: AiFailureKind;
  /** HTTP status when the provider answered with one; 0 when there is none. */
  status: number;
}

function statusAndDetail(error: unknown): { status: number; detail: string } {
  if (error instanceof ChatCompletionError) {
    return { status: error.status, detail: error.detail };
  }
  return { status: 0, detail: error instanceof Error ? error.message : String(error) };
}

// Order matters: a provider hard cap arrives as a 400 with "Budget has been
// exceeded" (AI-4), so the budget test comes before the status ones.
export function classifyFailure(error: unknown): AiFailureClass {
  const { status, detail } = statusAndDetail(error);
  if (/budget/i.test(detail)) {
    return { kind: 'budget', status };
  }
  if (status === 401 || status === 403) {
    return { kind: 'key_rejected', status };
  }
  if (status === 429) {
    return { kind: 'rate_limited', status };
  }
  if ((status === 400 || status === 404) && /model/i.test(detail)) {
    return { kind: 'model_not_found', status };
  }
  if (/context|too long|maximum context|token limit/i.test(detail)) {
    return { kind: 'context_too_long', status };
  }
  if (status === 0 && /timed out|timeout/i.test(detail)) {
    return { kind: 'timeout', status };
  }
  if (status !== 0) {
    return { kind: 'provider_error', status };
  }
  return { kind: 'other', status };
}

// The fields a failure log carries: the class and, only when the provider
// answered with one, the HTTP status. Never the provider's message (AI-22).
export function failureLogFields(error: unknown): { kind: AiFailureKind; status?: number } {
  const { kind, status } = classifyFailure(error);
  return status === 0 ? { kind } : { kind, status };
}

import { ApiError } from '@zilar/api-contract';
import { Effect } from 'effect';

import type { AiMemory, AiMemoryApi } from '@/lib/ai-memory-api';

export const MEMORY_LOAD_FAILED_MESSAGE = 'Could not load the memory';

export const MEMORY_FORGET_FAILED_MESSAGE = 'Could not forget that fact';

export const MEMORY_CLEAR_FAILED_MESSAGE = 'Could not clear the memory';

export type AiMemoryStatus = 'loading' | 'ready' | 'error';

export interface AiMemorySectionState {
  open: boolean;
  status: AiMemoryStatus;
  memory: AiMemory | null;
  forgetError: string;
  forgettingId: string | null;
  clearError: string;
  confirmingClear: boolean;
}

export interface AiMemorySectionActions {
  onShow: () => void;
  onHide: () => void;
  onRetry: () => void;
  onForget: (factId: string) => void;
  onAskClear: () => void;
  onCancelClear: () => void;
  onConfirmClear: () => void;
}

export function removeFact(memory: AiMemory, factId: string): AiMemory {
  return { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
}

/** A 404 means the fact is already gone, which the caller treats as success. */
export const requestForgetFactEffect = (
  api: AiMemoryApi,
  chat: string,
  aiId: string,
  factId: string,
) =>
  Effect.tryPromise({
    try: () => api.forgetFact(chat, aiId, factId),
    catch: (cause) => cause,
  }).pipe(
    Effect.catch((error) =>
      error instanceof ApiError && error.status === 404 ? Effect.void : Effect.fail(error),
    ),
  );

export const requestForgetFact = (
  api: AiMemoryApi,
  chat: string,
  aiId: string,
  factId: string,
): Promise<void> => Effect.runPromise(requestForgetFactEffect(api, chat, aiId, factId));

export const clearAiMemoryEffect = (api: AiMemoryApi, chat: string, aiId: string) =>
  Effect.tryPromise({ try: () => api.clear(chat, aiId), catch: (cause) => cause }).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({ try: () => api.getMemory(chat, aiId), catch: (cause) => cause }),
    ),
  );

export const clearAiMemory = (api: AiMemoryApi, chat: string, aiId: string): Promise<AiMemory> =>
  Effect.runPromise(clearAiMemoryEffect(api, chat, aiId));

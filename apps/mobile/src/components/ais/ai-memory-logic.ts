import { Effect } from 'effect';

import { AiMemoryApiError, type AiMemory, type AiMemoryApi } from '@/lib/ai-memory-api';

/** Fixed user-facing line when the memory fails to load. */
export const MEMORY_LOAD_FAILED_MESSAGE = 'Could not load the memory';

/** Fixed user-facing line when forgetting a fact fails. */
export const MEMORY_FORGET_FAILED_MESSAGE = 'Could not forget that fact';

/** Fixed user-facing line when clearing the memory fails. */
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

/** The memory without one fact, for the optimistic row removal after Forget. */
export function removeFact(memory: AiMemory, factId: string): AiMemory {
  return { ...memory, facts: memory.facts.filter((fact) => fact.id !== factId) };
}

/**
 * Forgets one fact on the server. A 404 means the fact is already gone, which
 * the caller treats as success; any other failure fails the Effect with the
 * api's own error.
 */
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
      error instanceof AiMemoryApiError && error.status === 404 ? Effect.void : Effect.fail(error),
    ),
  );

/** Promise form of `requestForgetFactEffect`: any other failure throws. */
export const requestForgetFact = (
  api: AiMemoryApi,
  chat: string,
  aiId: string,
  factId: string,
): Promise<void> => Effect.runPromise(requestForgetFactEffect(api, chat, aiId, factId));

/** Clears the memory on the server, then reloads and returns the empty one. */
export const clearAiMemoryEffect = (api: AiMemoryApi, chat: string, aiId: string) =>
  Effect.tryPromise({ try: () => api.clear(chat, aiId), catch: (cause) => cause }).pipe(
    Effect.flatMap(() =>
      Effect.tryPromise({ try: () => api.getMemory(chat, aiId), catch: (cause) => cause }),
    ),
  );

/** Promise form of `clearAiMemoryEffect`. */
export const clearAiMemory = (api: AiMemoryApi, chat: string, aiId: string): Promise<AiMemory> =>
  Effect.runPromise(clearAiMemoryEffect(api, chat, aiId));

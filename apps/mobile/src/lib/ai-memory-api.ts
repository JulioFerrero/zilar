import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * `AiMemoryApiError` is the shared `ApiError`, so the section shows fixed sentences, never server text.
 */

export interface AiMemoryFact {
  id: string;
  text: string;
}

export interface AiMemory {
  facts: AiMemoryFact[];
  lines: string[];
  canChange: boolean;
}

export interface AiMemoryApi {
  getMemory(chat: string, aiId: string): Promise<AiMemory>;
  forgetFact(chat: string, aiId: string, factId: string): Promise<void>;
  clear(chat: string, aiId: string): Promise<void>;
}

export const AiMemoryApiError = ApiError;
export type AiMemoryApiError = ApiError;

export function createAiMemoryApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiMemoryApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    async getMemory(chat, aiId) {
      const memory = await runApi(client.aiMemory.view({ query: { chat, ai: aiId } }));
      return { facts: [...memory.facts], lines: [...memory.lines], canChange: memory.canChange };
    },

    async forgetFact(chat, aiId, factId) {
      await runApi(
        client.aiMemory.deleteFact({ params: { id: factId }, query: { chat, ai: aiId } }),
      );
    },

    async clear(chat, aiId) {
      await runApi(client.aiMemory.clear({ payload: { chat, ai: aiId } }));
    },
  };
}

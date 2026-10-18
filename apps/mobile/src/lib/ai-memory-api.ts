import { runApi, type AiMemoryView } from '@zilar/api-contract';
import { makeChatExtrasApi } from '@zilar/client-core';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

export type { AiMemoryView as AiMemory, AiMemoryFact } from '@zilar/api-contract';

/** Errors are the shared `ApiError`, so the section shows fixed sentences, never server text. */
export interface AiMemoryApi {
  getMemory(chat: string, aiId: string): Promise<AiMemoryView>;
  forgetFact(chat: string, aiId: string, factId: string): Promise<void>;
  clear(chat: string, aiId: string): Promise<void>;
}

export function createAiMemoryApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): AiMemoryApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeChatExtrasApi((call) => runApi(call(client)));
  return {
    getMemory: api.getAiMemory,
    forgetFact: api.forgetAiMemoryFact,
    clear: api.clearAiMemory,
  };
}

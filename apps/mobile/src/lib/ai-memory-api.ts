import { ApiError, runApi } from '@zilar/api-contract';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';

/**
 * The AI memory API (`GET /api/ai-memory`, `DELETE /api/ai-memory/facts/:id`
 * and `POST /api/ai-memory/clear`), the mobile twin of the web client in
 * `apps/web/src/lib/api.ts`. A Promise port over the client derived from the
 * shared contract (`@zilar/api-contract`, `ai-memory.ts`, T-0893).
 * `AiMemoryApiError` is the shared `ApiError`, which keeps the server's
 * `code` and `status`, so the section can show fixed user-facing sentences
 * instead of server text.
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

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const AiMemoryApiError = ApiError;
export type AiMemoryApiError = ApiError;

/** The production `AiMemoryApi`: bearer auth, `fetch`, and the build-time API URL. */
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

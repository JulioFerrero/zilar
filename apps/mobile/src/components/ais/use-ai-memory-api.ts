import { createAiMemoryApi, type AiMemoryApi } from '@/lib/ai-memory-api';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realAiMemoryApi = () => createAiMemoryApi(getSessionToken);

const mockAiMemoryApi = (mockFetch: typeof fetch) =>
  createAiMemoryApi(mockToken, mockFetch, API_URL);

export interface AiMemoryApiHandle {
  api: AiMemoryApi;
  mock: boolean;
}

export function useAiMemoryApi(): AiMemoryApiHandle {
  return useMockableApi(realAiMemoryApi, mockAiMemoryApi);
}

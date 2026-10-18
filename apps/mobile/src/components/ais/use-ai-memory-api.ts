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
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`, so the AI edit screen shows the section without a server.
 */
export function useAiMemoryApi(): AiMemoryApiHandle {
  return useMockableApi(realAiMemoryApi, mockAiMemoryApi);
}

import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { createToolsApi, type AiToolsApi } from '@/lib/tools-api';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realToolsApi = () => createToolsApi(getSessionToken);

const mockToolsApi = (mockFetch: typeof fetch) => createToolsApi(mockToken, mockFetch, API_URL);

export interface ToolsApiHandle {
  api: AiToolsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`, so the AI edit screen shows both sections without a server.
 */
export function useToolsApi(): ToolsApiHandle {
  return useMockableApi(realToolsApi, mockToolsApi);
}

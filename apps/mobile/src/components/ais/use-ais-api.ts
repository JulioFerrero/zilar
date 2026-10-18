import { createAisApi, type AisApi } from '@/lib/ais-api';
import { API_URL } from '@/lib/auth';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realAisApi = () => createAisApi(getSessionToken);

const mockAisApi = (mockFetch: typeof fetch) => createAisApi(mockToken, mockFetch, API_URL);

export interface AisApiHandle {
  api: AisApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`, so the AI list and an AI's page work end to end without
 * a server.
 */
export function useAisApi(): AisApiHandle {
  return useMockableApi(realAisApi, mockAisApi);
}

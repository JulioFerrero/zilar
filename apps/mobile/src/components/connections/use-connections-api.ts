import { API_URL } from '@/lib/auth';
import { createConnectionsApi, type ConnectionsApi } from '@/lib/connections-api';
import { getSessionToken } from '@/lib/session-token';
import { useMockableApi } from '@/lib/use-mockable-api';
import { mockToken } from '@/mock/gate';

const realConnectionsApi = () => createConnectionsApi(getSessionToken);

const mockConnectionsApi = (mockFetch: typeof fetch) =>
  createConnectionsApi(mockToken, mockFetch, API_URL);

export interface ConnectionsApiHandle {
  api: ConnectionsApi;
  /** True when the mock is active (used by tests/UI to skip the network). */
  mock: boolean;
}

/**
 * Picks the real API or the mock one from the route's `?mock=` param or the
 * bundle-time `EXPO_PUBLIC_ZILAR_MOCK` env. The mock runs on the shared backend
 * through `mockFetch`.
 */
export function useConnectionsApi(): ConnectionsApiHandle {
  return useMockableApi(realConnectionsApi, mockConnectionsApi);
}

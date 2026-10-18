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
  mock: boolean;
}

export function useConnectionsApi(): ConnectionsApiHandle {
  return useMockableApi(realConnectionsApi, mockConnectionsApi);
}
